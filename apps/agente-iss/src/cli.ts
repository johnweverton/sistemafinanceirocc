// Agente de faturamento ISS Fortaleza — CLI (Story 13.2, Épico 13).
// Arquitetura: docs/architecture/feature-agente-faturamento-iss.md.
//
// Fluxo: busca os alvos no sistema → login no portal → para cada empresa (em série, 1 navegador):
// trocar inscrição → Manter Escrituração → Visualizar → Somatório de Serviços Prestados → no fim,
// UM envio com tudo (proposta para conferência — decisão G3). O JSON fica salvo localmente antes
// do envio; se o envio falhar, `--reenviar` manda de novo sem abrir o portal.
import { hostname } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import type { AlvoIss, AlvosIssResposta, NovaCapturaIss, NovaExecucaoIss } from '@cobranca/shared';
import { AJUDA, ErroArgs, lerOpcoes } from './args';
import { carregarConfig, ErroConfig } from './config';
import { buscarAlvos, enviarExecucao, ErroApi } from './api-client';
import { criarDiagnostico, redigirCpf } from './diagnostico';
import { ErroComunicadoPendente, ErroEmpresaNaoEncontrada, ErroLogin, PortalIss } from './portal/portal';
import { montarExecucao, resumoTexto, type ResultadoEmpresa } from './relatorio';

const VERSAO = '0.1.0';

function carimbo(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function capturaBase(alvo: AlvoIss): Omit<NovaCapturaIss, 'status'> {
  return {
    clienteContabilidadeId: alvo.clienteContabilidadeId,
    valorServicosPrestados: null,
    quantidadeNotas: null,
    situacaoIss: null,
    competenciaFechada: null,
    inscricaoMunicipal: null,
    razaoSocialIss: null,
    mensagemErro: null,
    capturadoEm: new Date().toISOString(),
  };
}

async function enviar(sistemaUrl: string, token: string, execucao: NovaExecucaoIss, arquivo: string): Promise<boolean> {
  try {
    const r = await enviarExecucao(sistemaUrl, token, execucao);
    const t = r.totais;
    console.log(
      `\nEnviado ao sistema (execução ${r.execucaoId}): ${t.capturado} capturados, ${t.nao_encontrado} não encontrados, ` +
        `${t.sem_escrituracao} sem escrituração, ${t.erro} com erro${r.comAlerta ? ` — ${r.comAlerta} com ALERTA` : ''}.`,
    );
    console.log('Os valores aparecem como proposta no diálogo de lote dos clientes contábeis, para conferência.');
    return true;
  } catch (e) {
    console.error(`\nFalha ao enviar ao sistema: ${(e as Error).message}`);
    console.error(`O resultado está salvo. Para reenviar sem abrir o portal:\n  npm run iss:faturamento -- --reenviar "${arquivo}"`);
    return false;
  }
}

async function main(): Promise<number> {
  const opts = lerOpcoes(process.argv.slice(2));
  if (opts.ajuda) {
    console.log(AJUDA);
    return 0;
  }
  const cfg = carregarConfig(undefined, { apenasPortal: opts.offline });

  if (opts.reenviar) {
    const execucao = JSON.parse(readFileSync(opts.reenviar, 'utf8')) as NovaExecucaoIss;
    return (await enviar(cfg.sistemaUrl, cfg.token, execucao, opts.reenviar)) ? 0 : 2;
  }

  const pastaExecucao = join(cfg.pastaBase, 'execucoes', `${carimbo()}-${opts.competencia}`);
  mkdirSync(pastaExecucao, { recursive: true });
  const diag = criarDiagnostico(pastaExecucao, cfg.issCpf, opts.reconhecer);
  diag.log(`Agente ISS v${VERSAO} — competência ${opts.competencia} — saída em ${pastaExecucao}`);

  // 1. Alvos (no --offline, vêm de --cnpj; o id é fictício porque nada vai ao sistema)
  const resposta: AlvosIssResposta = opts.offline
    ? {
        competencia: opts.competencia,
        alvos: opts.documentos.map((documento) => ({
          clienteContabilidadeId: '00000000-0000-0000-0000-000000000000',
          nome: documento,
          documento,
        })),
        semDocumento: [],
      }
    : await buscarAlvos(cfg.sistemaUrl, cfg.token, opts.competencia);
  if (opts.offline) diag.log('Modo --offline: nada será enviado ao sistema.');
  let alvos = resposta.alvos;
  if (opts.documentos.length) {
    alvos = alvos.filter((a) => opts.documentos.includes(a.documento));
    const faltam = opts.documentos.filter((d) => !resposta.alvos.some((a) => a.documento === d));
    if (faltam.length) diag.log(`Aviso: não são clientes ativos em faixa de faturamento: ${faltam.join(', ')}`);
  }
  if (opts.limite) alvos = alvos.slice(0, opts.limite);
  if (resposta.semDocumento.length) {
    diag.log(
      `Aviso: ${resposta.semDocumento.length} cliente(s) sem CPF/CNPJ no cadastro — não dá para buscar no portal: ` +
        resposta.semDocumento.map((s) => s.nome).join('; '),
    );
  }
  if (alvos.length === 0) {
    diag.log('Nenhuma empresa para buscar.');
    return 0;
  }
  diag.log(`${alvos.length} empresa(s) para buscar.`);

  // 2. Portal
  const iniciadoEm = new Date();
  const resultados: ResultadoEmpresa[] = [];
  const arquivoJson = join(pastaExecucao, 'execucao.json');
  const salvar = () => {
    const execucao = montarExecucao({
      competencia: opts.competencia,
      iniciadoEm,
      finalizadoEm: new Date(),
      maquina: hostname(),
      versaoAgente: VERSAO,
      resultados,
    });
    writeFileSync(arquivoJson, JSON.stringify(execucao, null, 2));
    return execucao;
  };

  let browser: Browser | null = null;
  process.once('SIGINT', () => {
    diag.log('Interrompido (Ctrl+C) — salvando o que já foi lido, SEM enviar.');
    if (resultados.length) salvar();
    void browser?.close();
    process.exit(130);
  });

  try {
    browser = await chromium
      .launch({ channel: 'chrome', headless: !opts.headed })
      .catch(() => chromium.launch({ headless: !opts.headed })); // sem Chrome instalado: Chromium do Playwright
    const context = await browser.newContext({ locale: 'pt-BR', acceptDownloads: false, viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const portal = new PortalIss(page, diag);
    await portal.login(cfg.issCpf, cfg.issSenha);

    for (const [i, alvo] of alvos.entries()) {
      diag.log(`(${i + 1}/${alvos.length}) ${alvo.nome} — ${alvo.documento}`);
      let captura: NovaCapturaIss | null = null;
      for (let tentativa = 1; tentativa <= 2 && !captura; tentativa += 1) {
        try {
          if (portal.sessaoPerdida()) await portal.recuperar(cfg.issCpf, cfg.issSenha);
          const empresa = await portal.selecionarEmpresa(alvo.documento);
          const leitura = await portal.lerCompetencia(opts.competencia);
          const base = { ...capturaBase(alvo), inscricaoMunicipal: empresa.inscricao, razaoSocialIss: empresa.razaoSocial };
          captura =
            leitura.tipo === 'capturado'
              ? {
                  ...base,
                  status: 'capturado',
                  valorServicosPrestados: leitura.valor,
                  quantidadeNotas: leitura.quantidade,
                  situacaoIss: leitura.situacao || null,
                  competenciaFechada: leitura.fechada,
                }
              : { ...base, status: 'sem_escrituracao' };
        } catch (e) {
          if (e instanceof ErroLogin) throw e; // senha errada: parar tudo (não arriscar bloqueio)
          if (e instanceof ErroEmpresaNaoEncontrada) {
            captura = { ...capturaBase(alvo), status: 'nao_encontrado', mensagemErro: e.message };
            break;
          }
          const sessaoCaiu = portal.sessaoPerdida();
          if (sessaoCaiu && tentativa === 1) {
            diag.log('  sessão caiu no meio — relogando e tentando esta empresa de novo');
            await portal.recuperar(cfg.issCpf, cfg.issSenha);
            continue;
          }
          const msg = redigirCpf((e as Error).message, cfg.issCpf).slice(0, 900);
          if (!(e instanceof ErroComunicadoPendente)) await diag.snapshot(page, `erro-${alvo.documento}`);
          captura = { ...capturaBase(alvo), status: 'erro', mensagemErro: msg };
          await portal.recuperar(cfg.issCpf, cfg.issSenha).catch(() => undefined);
        }
      }
      const c = captura ?? { ...capturaBase(alvo), status: 'erro' as const, mensagemErro: 'Sem resultado' };
      resultados.push({ nome: alvo.nome, documento: alvo.documento, captura: c });
      diag.log(
        `  → ${c.status}${c.status === 'capturado' ? ` R$ ${c.valorServicosPrestados?.toFixed(2)} (${c.situacaoIss})` : c.mensagemErro ? `: ${c.mensagemErro}` : ''}`,
      );
      salvar(); // parcial a cada empresa: queda no meio não perde o que já foi lido
      await page.waitForTimeout(500); // ritmo de uso humano
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  // 3. Resultado
  const execucao = salvar();
  console.log('\n' + resumoTexto(opts.competencia, resultados));
  console.log(`\nResultado salvo em ${arquivoJson}`);
  if (opts.semEnvio) {
    console.log(`${opts.offline ? '--offline' : '--sem-envio'}: nada foi enviado ao sistema.`);
    return 0;
  }
  return (await enviar(cfg.sistemaUrl, cfg.token, execucao, arquivoJson)) ? 0 : 2;
}

main().then(
  (codigo) => process.exit(codigo),
  (e) => {
    const conhecido = e instanceof ErroArgs || e instanceof ErroConfig || e instanceof ErroApi || e instanceof ErroLogin;
    console.error(conhecido ? `\n${(e as Error).message}` : e);
    process.exit(1);
  },
);
