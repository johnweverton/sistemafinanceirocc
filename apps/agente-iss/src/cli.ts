// Agente de faturamento ISS Fortaleza — CLI (Story 13.2, Épico 13).
// Arquitetura: docs/architecture/feature-agente-faturamento-iss.md.
//
// Fluxo: busca os alvos no sistema → login no portal → para cada empresa (em série, 1 navegador):
// trocar inscrição → Manter Escrituração → Visualizar → Somatório de Serviços Prestados → no fim,
// UM envio com tudo (proposta para conferência — decisão G3). O JSON fica salvo localmente antes
// do envio; se o envio falhar, fica a marca `envio-pendente` e a próxima execução reenvia sozinha
// (Story 13.4) — `--reenviar` continua existindo para o reenvio manual.
//
// Story 13.4: sem nenhum argumento num terminal interativo, roda o MODO ASSISTENTE (pergunta a
// competência, confirma, e no fim oferece abrir o diálogo de lote); `configurar` grava o `.env`.
//
// Story 13.5: o miolo de uma rodada mora em `executarCompetencia` (executar-competencia.ts),
// compartilhado com os modos `--vigiar`/`--uma-vez` (vigiar.ts), que atendem os pedidos feitos
// pelo botão "Buscar no ISS" do sistema web.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { NovaExecucaoIss } from '@cobranca/shared';
import { AJUDA, ErroArgs, lerOpcoes, type OpcoesCli } from './args';
import {
  comTerminal,
  confirmarInicio,
  deveUsarAssistente,
  iniciarAssistente,
  linkDoLote,
  oferecerAbrirLink,
} from './assistente';
import { executarConfigurar } from './configurar';
import { ehRecusaDefinitiva, enviarComMarca, reenviarPendentes } from './reenvio';
import { carregarConfig, ErroConfig, type ConfigAgente } from './config';
import {
  buscarProximaSolicitacao,
  concluirSolicitacao,
  enviarExecucao,
  enviarProgresso,
  ErroApi,
} from './api-client';
import { redigirCredenciais } from './diagnostico';
import { ErroLogin } from './portal/portal';
import { executarCompetencia } from './executar-competencia';
import { resumoTexto } from './relatorio';
import { vigiar } from './vigiar';

async function enviar(sistemaUrl: string, token: string, execucao: NovaExecucaoIss, arquivo: string): Promise<boolean> {
  try {
    // Story 13.4 (AC 6): falha grava `envio-pendente` ao lado do JSON; sucesso o remove.
    const r = await enviarComMarca(arquivo, execucao, (e) => enviarExecucao(sistemaUrl, token, e));
    const t = r.totais;
    console.log(
      `\nEnviado ao sistema (execução ${r.execucaoId}): ${t.capturado} capturados, ${t.nao_encontrado} não encontrados, ` +
        `${t.sem_escrituracao} sem escrituração, ${t.erro} com erro${r.comAlerta ? ` — ${r.comAlerta} com ALERTA` : ''}.`,
    );
    console.log('Os valores aparecem como proposta no diálogo de lote dos clientes contábeis, para conferência.');
    return true;
  } catch (e) {
    console.error(`\nFalha ao enviar ao sistema: ${(e as Error).message}`);
    if (ehRecusaDefinitiva(e)) {
      // QA 13.4/13.5: recusa que não muda sozinha — não vai para a fila de reenvio.
      console.error(`O sistema recusou o resultado; ele NÃO será reenviado. O arquivo continua em ${arquivo}.`);
      return false;
    }
    console.error(
      'O resultado está salvo e será reenviado automaticamente na próxima execução do agente.\n' +
        `(Reenvio manual, se preferir: npm run iss:faturamento -- --reenviar "${arquivo}")`,
    );
    return false;
  }
}

const escrever = (texto: string) => console.log(texto);

/**
 * Story 13.5 (AC 15, 16): atende os pedidos do sistema web. O log vai para o console E para
 * `<pastaBase>\vigiar.log` — na tarefa agendada ninguém vê a janela.
 */
function rodarVigiar(opts: OpcoesCli, cfg: ConfigAgente): Promise<number> {
  mkdirSync(cfg.pastaBase, { recursive: true });
  const arquivoLog = join(cfg.pastaBase, 'vigiar.log');
  const log = (msg: string) => {
    const linha = `[${new Date().toLocaleString('pt-BR')}] ${redigirCredenciais(msg, cfg.issCpf, cfg.issSenha)}`;
    console.log(linha);
    try {
      appendFileSync(arquivoLog, linha + '\n');
    } catch {
      /* log em disco é conveniência — nunca derruba o agente */
    }
  };
  const maquina = hostname();
  return vigiar(
    { umaVez: opts.umaVez },
    {
      buscarProxima: () => buscarProximaSolicitacao(cfg.sistemaUrl, cfg.token, maquina),
      enviarProgresso: (id, atual, total) => enviarProgresso(cfg.sistemaUrl, cfg.token, id, atual, total),
      enviarExecucao: (execucao, arquivoJson) =>
        enviarComMarca(arquivoJson, execucao, (e) => enviarExecucao(cfg.sistemaUrl, cfg.token, e)),
      concluir: (id, conclusao) => concluirSolicitacao(cfg.sistemaUrl, cfg.token, id, conclusao),
      executar: (o) =>
        executarCompetencia({ ...o, config: cfg, headed: opts.headed, reconhecer: opts.reconhecer }),
      reenviarPendentes: () =>
        reenviarPendentes(cfg.pastaBase, (e) => enviarExecucao(cfg.sistemaUrl, cfg.token, e), log),
      esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
      log,
      redigir: (msg) => redigirCredenciais(msg, cfg.issCpf, cfg.issSenha),
    },
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // Story 13.4 (AC 13): subcomando despachado ANTES de `lerOpcoes` (que não aceita posicionais).
  if (argv[0] === 'configurar') {
    return comTerminal((t) => executarConfigurar({ perguntar: t.perguntar, perguntarSenha: t.perguntarSenha, escrever }));
  }

  // Story 13.4 (AC 9, 10): assistente só sem argumentos E com terminal interativo.
  const assistente = deveUsarAssistente(argv, process.stdin.isTTY);
  let argvEfetivo = argv;
  if (assistente) {
    const competencia = await comTerminal((t) => iniciarAssistente(t.perguntar, escrever));
    if (!competencia) return 1;
    argvEfetivo = ['--competencia', competencia];
  }

  const opts = lerOpcoes(argvEfetivo);
  if (opts.ajuda) {
    console.log(AJUDA);
    return 0;
  }
  const cfg = carregarConfig(undefined, { apenasPortal: opts.offline });

  if (opts.vigiar || opts.umaVez) return rodarVigiar(opts, cfg);

  if (opts.reenviar) {
    const execucao = JSON.parse(readFileSync(opts.reenviar, 'utf8')) as NovaExecucaoIss;
    return (await enviar(cfg.sistemaUrl, cfg.token, execucao, opts.reenviar)) ? 0 : 2;
  }

  // Story 13.4 (AC 6): antes de qualquer alvo novo, reenvia o que ficou pendente de execuções
  // anteriores. Nunca interrompe esta execução. [AUTO-DECISION] Pulado em --offline/--sem-envio:
  // o primeiro nem tem token/URL, e o segundo promete não enviar nada ao sistema.
  if (!opts.semEnvio) {
    await reenviarPendentes(cfg.pastaBase, (e) => enviarExecucao(cfg.sistemaUrl, cfg.token, e));
  }

  const { execucao, resultados, arquivoJson } = await executarCompetencia({
    competencia: opts.competencia,
    documentos: opts.documentos,
    config: cfg,
    limite: opts.limite,
    headed: opts.headed,
    reconhecer: opts.reconhecer,
    offline: opts.offline,
    // No modo CLI o progresso já aparece no log "(N/total)"; nada vai à rede por ele.
    confirmarInicio: assistente
      ? (n) => comTerminal((t) => confirmarInicio(t.perguntar, escrever, opts.competencia, n))
      : undefined,
  });
  if (!execucao) return 0; // nenhuma empresa para buscar, ou o operador não confirmou

  console.log('\n' + resumoTexto(opts.competencia, resultados));
  console.log(`\nResultado salvo em ${arquivoJson}`);
  if (opts.semEnvio) {
    console.log(`${opts.offline ? '--offline' : '--sem-envio'}: nada foi enviado ao sistema.`);
    return 0;
  }
  const enviado = await enviar(cfg.sistemaUrl, cfg.token, execucao, arquivoJson);
  // Story 13.4 (AC 11): no assistente, o fim aponta direto para o diálogo de lote da competência.
  if (enviado && assistente) {
    const link = linkDoLote(cfg.sistemaUrl, opts.competencia);
    await comTerminal((t) => oferecerAbrirLink(t.perguntar, escrever, link));
  }
  return enviado ? 0 : 2;
}

main().then(
  (codigo) => process.exit(codigo),
  (e) => {
    const conhecido = e instanceof ErroArgs || e instanceof ErroConfig || e instanceof ErroApi || e instanceof ErroLogin;
    console.error(conhecido ? `\n${(e as Error).message}` : e);
    process.exit(1);
  },
);
