// Busca no ISS pela NUVEM (Vercel, região São Paulo) — substitui o agente do computador do
// escritório. Spike de 2026-09-29: o portal aceitou login e leitura a partir da Vercel.
//
// Uma função da Vercel vive poucos minutos e a carteira inteira leva ~30 min, então a busca roda
// em LOTES: cada lote reivindica a solicitação (`maquina` = dono do lote), faz UM login, lê
// empresas até estourar o orçamento de tempo, grava as capturas na execução da solicitação e
// libera o lote para o próximo — que é disparado na hora (`dispararProximoLote`) e, se o disparo
// falhar, pelo polling da tela (GET iss-solicitacoes) ou pela expiração do lease (90 s).
//
// Mesmas regras do agente local: só LÊ o portal (driver `PortalIss` compartilhado), senha
// recusada encerra a solicitação como `falhou` sem tentar de novo (não bloquear o MASTER), e a
// leitura de cada empresa é a mesma função (`lerEmpresa`).
//
// Incidente de 2026-10-01 (busca de 32 empresas, competência 2026-09): depois de ~4 lotes
// encadeados a instância da Vercel parou de conseguir abrir conexão — `page.goto` devolveu
// `net::ERR_INSUFFICIENT_RESOURCES` no login, e a tentativa seguinte falhou em 1,3 s (sinal de
// instância reaproveitada já sem recursos, não de portal fora do ar). Três defesas vieram daí:
//   1. o lote nunca pode ser derrubado no meio pelo `maxDuration` (TETO_INVOCACAO_MS), senão o
//      Chromium fica para trás na instância e envenena o próximo lote;
//   2. antes de abrir o navegador, varre /tmp e apaga perfil de navegador abandonado;
//   3. erro de infraestrutura no login NÃO mata a solicitação (`adiar`): o lease vence e outra
//      invocação retoma de onde parou — a solicitação só falha de vez por senha recusada ou
//      depois de TETO_ADIAMENTO_MS insistindo.
import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync, statSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitUntil } from '@vercel/functions';
import type { AlvoIss, NovaCapturaIss, SolicitacaoIss } from '@cobranca/shared';
import { PortalIss, ErroLogin, type Diagnostico } from '@cobranca/agente-iss/src/portal/portal';
import { capturaBase, lerEmpresa, type PortalParaExecucao } from '@cobranca/agente-iss/src/ler-empresa';
import { redigirCredenciais } from '@cobranca/agente-iss/src/diagnostico';
import {
  anexarCapturasNuvemIss,
  clientesLidosNaExecucaoIss,
  listarAlvosIss,
} from '@/server/repositories/iss-captura-repository';
import {
  concluirSolicitacaoIss,
  reivindicarLoteNuvemIss,
  renovarLoteNuvemIss,
  LEASE_NUVEM_EXPIRADO_MS,
} from '@/server/repositories/iss-solicitacao-repository';

export const VERSAO_NUVEM = 'nuvem-1';
/** Não começa empresa nova depois disto: sobra folga para terminar a atual dentro dos 300 s. */
export const ORCAMENTO_LOTE_MS = 150_000;
/**
 * Prazo MÁXIMO de uma leitura, contado do início do lote. O `maxDuration` da rota é 300 s e o que
 * sobra depois disto é o encerramento: fechar o navegador (até 10 s), gravar as capturas e
 * disparar o próximo lote (até 15 s no fetch) — por isso 240 s, e não um número colado no limite.
 * Uma empresa pode encostar nos timeouts do portal (60 s na troca de inscrição, 90 s na
 * visualização, tudo isso duas vezes quando a sessão cai) e passar de 150 s sozinha — sem este
 * teto a função era derrubada no meio e o Chromium ficava para trás na instância.
 */
export const TETO_INVOCACAO_MS = 240_000;
/** Leitura que estourou o prazo tendo este tanto disponível é problema DELA, não falta de tempo. */
const PRAZO_EMPRESA_CHEIO_MS = 180_000;
/**
 * Idade máxima de uma solicitação ABERTA — passou disto tropeçando na infraestrutura, encerra.
 * Cuidado com a leitura: `reivindicarLoteNuvemIss` preserva `iniciado_em` a cada lote, então isto
 * mede há quanto tempo a busca existe, NÃO quanto tempo ela passou insistindo. Uma carteira
 * inteira leva ~15 min; 1 h aberta sem conseguir logar é sinal de que insistir não resolve.
 * Contar adiamentos de verdade pediria coluna nova em `iss_solicitacoes` — ver seção 8.1 da
 * arquitetura.
 */
export const TETO_ADIAMENTO_MS = 60 * 60_000;
/**
 * Erro que não é da empresa: é a instância/navegador acabando. Dentro do laço, `lerEmpresa`
 * transforma isso em captura `erro` — e captura gravada conta como lida, então a empresa nunca
 * mais seria tentada. Reconhecer a assinatura é o que impede a carteira inteira de virar `erro`
 * em poucos segundos quando o recurso acaba DEPOIS do login.
 */
const ERRO_DE_INFRA = /ERR_INSUFFICIENT_RESOURCES|ERR_OUT_OF_MEMORY|has been closed|Target closed|Protocol error/i;
/** Perfil em /tmp mais velho que isto é de invocação morta (> `maxDuration`), nunca de lote vivo. */
const IDADE_RESIDUO_MS = 10 * 60_000;
const INTERVALO_HEARTBEAT_MS = 20_000;
const LIMITE_MENSAGEM = 1000;

/** A busca na nuvem está ligada quando a Vercel tem o login do ISS. */
export function buscaIssNaNuvemHabilitada(): boolean {
  return !!(process.env.ISS_CPF && process.env.ISS_SENHA);
}

export interface NavegadorNuvem {
  portal: PortalParaExecucao;
  fechar(): Promise<void>;
}

export interface DependenciasLoteNuvem {
  abrirNavegador(diag: Diagnostico): Promise<NavegadorNuvem>;
  reivindicar: typeof reivindicarLoteNuvemIss;
  renovar: typeof renovarLoteNuvemIss;
  concluir: typeof concluirSolicitacaoIss;
  listarAlvos: typeof listarAlvosIss;
  lidosNaExecucao: typeof clientesLidosNaExecucaoIss;
  anexar: typeof anexarCapturasNuvemIss;
  dispararProximo(): Promise<void>;
  agora(): Date;
  log(msg: string): void;
  intervaloHeartbeatMs?: number;
}

/** Quanto resta do /tmp (512 MB na Lambda) — Chromium extraído, perfil e cache moram todos lá. */
function recursosDaInstancia(): string {
  const partes = [`rss ${Math.round(process.memoryUsage.rss() / 1e6)} MB`];
  try {
    const fs = statfsSync(tmpdir());
    partes.push(`tmp ${Math.round((fs.bavail * fs.bsize) / 1e6)}/${Math.round((fs.blocks * fs.bsize) / 1e6)} MB livres`);
  } catch {
    partes.push('tmp ?');
  }
  return partes.join(', ');
}

/**
 * Apaga perfil de navegador que o Playwright não conseguiu remover (invocação derrubada no meio).
 * Só mexe no que é mais velho que `IDADE_RESIDUO_MS` — mais que o `maxDuration` da rota, então
 * nunca é o perfil de um lote que ainda está rodando em outra invocação da mesma instância.
 */
function limparPerfisAbandonados(log: (m: string) => void): void {
  const base = tmpdir();
  let apagados = 0;
  try {
    for (const nome of readdirSync(base)) {
      if (!/^playwright.*profile/i.test(nome) && !/^\.org\.chromium\.Chromium\./.test(nome)) continue;
      const caminho = join(base, nome);
      try {
        if (Date.now() - statSync(caminho).mtimeMs < IDADE_RESIDUO_MS) continue;
        rmSync(caminho, { recursive: true, force: true });
        apagados += 1;
      } catch {
        // perfil em uso ou sem permissão: deixa quieto
      }
    }
  } catch {
    return; // sem /tmp legível (ambiente de teste): nada a limpar
  }
  if (apagados) log(`limpei ${apagados} perfil(is) de navegador abandonado(s) em ${base}`);
}

async function abrirNavegadorServerless(diag: Diagnostico): Promise<NavegadorNuvem> {
  // @sparticuz/chromium só reconhece Node 20/22 da AWS e decide NO IMPORT: na Vercel com Node 24
  // não extrai as libs do Amazon Linux 2023 e o Chromium morre sem libnss3.so.
  if (process.env.VERCEL && !process.env.AWS_LAMBDA_JS_RUNTIME) process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs22.x';
  limparPerfisAbandonados(diag.log);
  diag.log(`abrindo o navegador — ${recursosDaInstancia()}`);
  const [{ default: chromiumServerless }, { chromium }] = await Promise.all([
    import('@sparticuz/chromium'),
    import('playwright-core'),
  ]);
  const browser = await chromium.launch({
    executablePath: await chromiumServerless.executablePath(),
    args: chromiumServerless.args,
    headless: true,
  });
  // `browser.close()` que não volta deixa o Chromium vivo na instância e o lote seguinte abre sem
  // recursos: espera no máximo 10 s e segue — o /tmp fica para a varredura da próxima invocação.
  const fechar = async () => {
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const fechou = await Promise.race([
      browser.close().then(() => true).catch(() => false),
      new Promise<boolean>((r) => {
        relogio = setTimeout(() => r(false), 10_000);
      }),
    ]).finally(() => clearTimeout(relogio)); // senão o timer segura a função viva por 10 s
    diag.log(`navegador ${fechou ? 'fechado' : 'NÃO fechou em 10 s'} — ${recursosDaInstancia()}`);
  };
  try {
    const context = await browser.newContext({ locale: 'pt-BR', acceptDownloads: false, viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    // O driver foi tipado com o `Page` do pacote `playwright`; é a mesma classe do playwright-core.
    const portal = new PortalIss(page as unknown as ConstructorParameters<typeof PortalIss>[0], diag);
    return { portal, fechar };
  } catch (e) {
    await fechar().catch(() => undefined);
    throw e;
  }
}

/**
 * Pede o próximo lote numa invocação NOVA da função (cada uma tem seus 300 s). Melhor esforço:
 * se falhar (ex.: preview protegido), o polling da tela ou a expiração do lease retomam.
 */
export async function dispararProximoLote(): Promise<void> {
  const token = process.env.AGENTE_ISS_TOKEN;
  // Em produção, o domínio de produção (a URL própria de cada implantação fica atrás da proteção
  // de login da Vercel); no preview, a URL da implantação + o segredo de bypass, se configurado.
  const host =
    process.env.VERCEL_ENV === 'production'
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : process.env.VERCEL_URL;
  if (!token || !host) return;
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const r = await fetch(`https://${host}/api/integracoes/iss/nuvem/lote`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`disparo do próximo lote respondeu ${r.status}`);
}

export const dependenciasLoteNuvemPadrao: DependenciasLoteNuvem = {
  abrirNavegador: abrirNavegadorServerless,
  reivindicar: reivindicarLoteNuvemIss,
  renovar: renovarLoteNuvemIss,
  concluir: concluirSolicitacaoIss,
  listarAlvos: listarAlvosIss,
  lidosNaExecucao: clientesLidosNaExecucaoIss,
  anexar: anexarCapturasNuvemIss,
  dispararProximo: dispararProximoLote,
  agora: () => new Date(),
  log: (msg) => console.log(`[iss-nuvem] ${msg}`),
};

export type DesfechoLoteNuvem = 'sem_trabalho' | 'lote_ok' | 'concluida' | 'falhou' | 'cancelada' | 'adiada';

class PrazoEmpresaEstourado extends Error {}

/** `promessa` com prazo — o que estourar vira `PrazoEmpresaEstourado` (a leitura segue e morre junto com o navegador). */
function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout>;
  const prazo = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new PrazoEmpresaEstourado()), ms);
  });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(relogio)) as Promise<T>;
}

/** Executa (no máximo) UM lote da solicitação ativa mais antiga que estiver disponível. */
export async function executarLoteNuvemIss(
  depsParciais: Partial<DependenciasLoteNuvem> = {},
): Promise<DesfechoLoteNuvem> {
  const deps: DependenciasLoteNuvem = { ...dependenciasLoteNuvemPadrao, ...depsParciais };
  const cpf = process.env.ISS_CPF ?? '';
  const senha = process.env.ISS_SENHA ?? '';
  if (!cpf || !senha) return 'sem_trabalho';

  const dono = `nuvem:${randomUUID().slice(0, 8)}`;
  const s = await deps.reivindicar(dono, deps.agora());
  if (!s) return 'sem_trabalho';
  const inicio = deps.agora().getTime();
  const log = (m: string) => deps.log(`[${s.id.slice(0, 8)} ${dono}] ${redigirCredenciais(m, cpf, senha)}`);

  const falhar = async (motivo: string): Promise<DesfechoLoteNuvem> => {
    const erro = redigirCredenciais(motivo, cpf, senha).slice(0, LIMITE_MENSAGEM);
    log(`falhou: ${erro}`);
    await deps.concluir(s.id, { erro }, deps.agora()).catch((e) => log(`não consegui concluir: ${(e as Error).message}`));
    return 'falhou';
  };

  /**
   * Tropeço de infraestrutura (instância sem recursos, portal fora do ar) — nada disso é culpa do
   * operador nem da senha, e a solicitação já pode ter dezenas de empresas lidas. Não conclui: só
   * para de renovar o lease, e quando ele vencer outra invocação retoma do ponto em que parou.
   * Insistir tem hora para acabar — passado `TETO_ADIAMENTO_MS` desde o início, falha de vez.
   */
  const adiar = async (motivo: string): Promise<DesfechoLoteNuvem> => {
    const erro = redigirCredenciais(motivo, cpf, senha).slice(0, LIMITE_MENSAGEM);
    const desdeInicio = deps.agora().getTime() - Date.parse(s.iniciadoEm ?? s.solicitadoEm);
    // Idade desconhecida não pode virar retentativa sem fim: na dúvida, encerra.
    if (!Number.isFinite(desdeInicio)) {
      return falhar(`${erro} — e a data de início da busca está inválida, então não dá para saber até quando insistir.`);
    }
    if (desdeInicio > TETO_ADIAMENTO_MS) {
      return falhar(`${erro} — a busca está aberta há ${Math.round(desdeInicio / 60_000)} min sem passar daqui.`);
    }
    log(`adiado (${erro}) — sem renovar o lease; outra invocação retoma em ~${Math.round(LEASE_NUVEM_EXPIRADO_MS / 1000)} s`);
    return 'adiada';
  };

  // 1. O que falta ler: alvos da solicitação menos o que já está gravado na execução dela.
  const resposta = await deps.listarAlvos(s.competencia);
  let alvos: AlvoIss[] = resposta.alvos;
  if (s.documentos?.length) alvos = alvos.filter((a) => s.documentos!.includes(a.documento));
  if (alvos.length === 0) {
    const semDoc = resposta.semDocumento.length
      ? ` ${resposta.semDocumento.length} cliente(s) sem CPF/CNPJ no cadastro.`
      : '';
    return falhar(`Nenhuma empresa para buscar nesta solicitação.${semDoc}`);
  }
  const lidos = s.execucaoId ? await deps.lidosNaExecucao(s.execucaoId) : new Set<string>();
  const restantes = alvos.filter((a) => !lidos.has(a.clienteContabilidadeId));
  const total = alvos.length;
  if (restantes.length === 0) {
    await deps.concluir(s.id, { execucaoId: s.execucaoId! }, deps.agora());
    return 'concluida';
  }
  log(`lote: ${lidos.size}/${total} já lidas, ${restantes.length} restantes — competência ${s.competencia}`);
  if (!(await deps.renovar(s.id, dono, { progresso: { atual: lidos.size, total } }, deps.agora()))) {
    return 'cancelada';
  }

  // 2. Sinal de vida independente do ritmo das empresas (uma troca de inscrição pode levar 1 min).
  let ativo = true;
  const heartbeat = setInterval(() => {
    deps
      .renovar(s.id, dono, {}, deps.agora())
      .then((ok) => {
        if (!ok) ativo = false;
      })
      .catch(() => undefined);
  }, deps.intervaloHeartbeatMs ?? INTERVALO_HEARTBEAT_MS);

  const capturas: NovaCapturaIss[] = [];
  const diag: Diagnostico = { log, reconhecer: false, snapshot: async () => null };
  let navegador: NavegadorNuvem | null = null;
  try {
    // 3. Portal: um login por lote. Senha recusada encerra a solicitação; o resto só adia o lote.
    try {
      navegador = await deps.abrirNavegador(diag);
      await navegador.portal.login(cpf, senha);
    } catch (e) {
      // Senha recusada é definitivo (não arriscar bloquear o MASTER). Qualquer outro tropeço aqui
      // é infraestrutura — ERR_INSUFFICIENT_RESOURCES da instância, portal fora do ar — e merece
      // outra invocação em vez de matar a busca inteira.
      if (e instanceof ErroLogin) {
        return await falhar(`${e.message} A busca não tenta de novo sozinha, para não bloquear o usuário do ISS.`);
      }
      return await adiar(`Não foi possível entrar no portal do ISS: ${(e as Error).message}`);
    }

    for (const alvo of restantes) {
      const decorrido = deps.agora().getTime() - inicio;
      if (decorrido > ORCAMENTO_LOTE_MS) break;
      if (!ativo) {
        log('solicitação cancelada ou lote tomado — parando');
        return 'cancelada';
      }
      log(`(${lidos.size + capturas.length + 1}/${total}) ${alvo.nome}`);
      let captura: NovaCapturaIss;
      const prazoEmpresa = TETO_INVOCACAO_MS - decorrido;
      try {
        captura = await comPrazo(
          lerEmpresa({
            portal: navegador.portal,
            alvo,
            competencia: s.competencia,
            cpf,
            senha,
            agora: deps.agora,
            log,
          }),
          prazoEmpresa,
        );
      } catch (e) {
        if (e instanceof PrazoEmpresaEstourado) {
          // Encerra o lote em vez de deixar a função ser derrubada pelo `maxDuration` — invocação
          // derrubada deixa o Chromium vivo na instância e o lote seguinte abre sem recursos.
          const segundos = Math.round(prazoEmpresa / 1000);
          log(`  → leitura passou de ${segundos} s; encerrando o lote antes do limite da função`);
          if (prazoEmpresa >= PRAZO_EMPRESA_CHEIO_MS) {
            // Teve o lote inteiro e não terminou: é esta empresa que está travando. Vira `erro`
            // para não prender a busca num laço de lotes relendo sempre a mesma.
            capturas.push({
              ...capturaBase(alvo, deps.agora()),
              status: 'erro',
              mensagemErro: `Leitura passou de ${segundos} s no portal e foi interrompida.`,
            });
          }
          break; // sem prazo cheio: o próximo lote recomeça esta empresa com a janela inteira
        }
        // Só ErroLogin chega aqui (relogin no meio recusado): grava o que já leu e encerra.
        if (capturas.length) await deps.anexar(dadosAnexo(s, capturas)).catch(() => undefined);
        return await falhar((e as Error).message);
      }
      if (captura.status === 'erro' && ERRO_DE_INFRA.test(captura.mensagemErro ?? '')) {
        // A instância acabou DEPOIS do login. Se seguir o laço, cada empresa restante vira `erro`
        // em 1-3 s, e `erro` gravado conta como lida: a carteira inteira se perderia em segundos,
        // sem retentativa. Guarda o que foi lido de verdade (com o `execucaoId` na solicitação,
        // senão o próximo lote relê tudo numa execução nova) e adia.
        log(`  → ${captura.mensagemErro}`);
        if (capturas.length) {
          const execucaoId = await deps.anexar(dadosAnexo(s, capturas)).catch(() => null);
          if (execucaoId) {
            await deps
              .renovar(s.id, dono, { execucaoId, progresso: { atual: lidos.size + capturas.length, total } }, deps.agora())
              .catch(() => false);
          }
        }
        return await adiar(`A instância ficou sem recursos no meio da leitura: ${captura.mensagemErro}`);
      }
      capturas.push(captura);
      log(`  → ${captura.status}${captura.status === 'capturado' ? ` R$ ${captura.valorServicosPrestados?.toFixed(2)}` : ''}`);
      if (!(await deps.renovar(s.id, dono, { progresso: { atual: lidos.size + capturas.length, total } }, deps.agora()))) {
        log('solicitação cancelada — parando sem gravar este lote');
        return 'cancelada';
      }
    }
  } finally {
    clearInterval(heartbeat);
    await navegador?.fechar().catch(() => undefined);
  }

  // 4. Grava o lote na execução da solicitação e decide: acabou, ou libera para o próximo lote.
  if (capturas.length === 0) {
    await deps.renovar(s.id, dono, { liberar: true }, deps.agora());
    return 'lote_ok';
  }
  const execucaoId = await deps.anexar(dadosAnexo(s, capturas));
  if (restantes.length === capturas.length) {
    await deps.concluir(s.id, { execucaoId }, deps.agora());
    log(`concluída: ${total} empresa(s)`);
    return 'concluida';
  }
  if (!(await deps.renovar(s.id, dono, { execucaoId, liberar: true }, deps.agora()))) return 'cancelada';
  log(`lote gravado (${lidos.size + capturas.length}/${total}); disparando o próximo`);
  await deps.dispararProximo().catch((e) => log(`não consegui disparar o próximo lote (${(e as Error).message}) — a tela ou o lease retomam`));
  return 'lote_ok';

  function dadosAnexo(sol: SolicitacaoIss, lote: NovaCapturaIss[]) {
    return {
      competencia: sol.competencia,
      execucaoId: sol.execucaoId,
      iniciadoEm: sol.iniciadoEm ?? new Date(inicio).toISOString(),
      maquina: 'nuvem (Vercel)',
      versao: VERSAO_NUVEM,
      capturas: lote,
    };
  }
}

/**
 * Roda um lote DEPOIS da resposta HTTP (a função continua viva até `maxDuration`). Quem chama
 * responde na hora; o lote só começa se reivindicar a solicitação — chamadas repetidas são baratas.
 */
export function agendarLoteNuvemIss(): void {
  if (!buscaIssNaNuvemHabilitada()) return;
  waitUntil(
    executarLoteNuvemIss().catch((e) => console.error(`[iss-nuvem] lote quebrou: ${(e as Error).message}`)),
  );
}
