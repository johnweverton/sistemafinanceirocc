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
import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import type { AlvoIss, NovaCapturaIss, SolicitacaoIss } from '@cobranca/shared';
import { PortalIss, ErroLogin, type Diagnostico } from '@cobranca/agente-iss/src/portal/portal';
import { lerEmpresa, type PortalParaExecucao } from '@cobranca/agente-iss/src/ler-empresa';
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
} from '@/server/repositories/iss-solicitacao-repository';

export const VERSAO_NUVEM = 'nuvem-1';
/** Não começa empresa nova depois disto: sobra folga para terminar a atual dentro dos 300 s. */
export const ORCAMENTO_LOTE_MS = 150_000;
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

async function abrirNavegadorServerless(diag: Diagnostico): Promise<NavegadorNuvem> {
  // @sparticuz/chromium só reconhece Node 20/22 da AWS e decide NO IMPORT: na Vercel com Node 24
  // não extrai as libs do Amazon Linux 2023 e o Chromium morre sem libnss3.so.
  if (process.env.VERCEL && !process.env.AWS_LAMBDA_JS_RUNTIME) process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs22.x';
  const [{ default: chromiumServerless }, { chromium }] = await Promise.all([
    import('@sparticuz/chromium'),
    import('playwright-core'),
  ]);
  const browser = await chromium.launch({
    executablePath: await chromiumServerless.executablePath(),
    args: chromiumServerless.args,
    headless: true,
  });
  try {
    const context = await browser.newContext({ locale: 'pt-BR', acceptDownloads: false, viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    // O driver foi tipado com o `Page` do pacote `playwright`; é a mesma classe do playwright-core.
    const portal = new PortalIss(page as unknown as ConstructorParameters<typeof PortalIss>[0], diag);
    return { portal, fechar: () => browser.close() };
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}

/**
 * Pede o próximo lote numa invocação NOVA da função (cada uma tem seus 300 s). Melhor esforço:
 * se falhar (ex.: preview protegido), o polling da tela ou a expiração do lease retomam.
 */
export async function dispararProximoLote(): Promise<void> {
  const token = process.env.AGENTE_ISS_TOKEN;
  const host = process.env.VERCEL_URL;
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

export type DesfechoLoteNuvem = 'sem_trabalho' | 'lote_ok' | 'concluida' | 'falhou' | 'cancelada';

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
    // 3. Portal: um login por lote. Senha recusada ou portal fora do ar encerram a solicitação.
    try {
      navegador = await deps.abrirNavegador(diag);
      await navegador.portal.login(cpf, senha);
    } catch (e) {
      return await falhar(
        e instanceof ErroLogin
          ? `${(e as Error).message} A busca não tenta de novo sozinha, para não bloquear o usuário do ISS.`
          : `Não foi possível entrar no portal do ISS: ${(e as Error).message}`,
      );
    }

    for (const alvo of restantes) {
      if (deps.agora().getTime() - inicio > ORCAMENTO_LOTE_MS) break;
      if (!ativo) {
        log('solicitação cancelada ou lote tomado — parando');
        return 'cancelada';
      }
      log(`(${lidos.size + capturas.length + 1}/${total}) ${alvo.nome}`);
      let captura: NovaCapturaIss;
      try {
        captura = await lerEmpresa({
          portal: navegador.portal,
          alvo,
          competencia: s.competencia,
          cpf,
          senha,
          agora: deps.agora,
          log,
        });
      } catch (e) {
        // Só ErroLogin chega aqui (relogin no meio recusado): grava o que já leu e encerra.
        if (capturas.length) await deps.anexar(dadosAnexo(s, capturas)).catch(() => undefined);
        return await falhar((e as Error).message);
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
