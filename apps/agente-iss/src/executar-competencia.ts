// Miolo de UMA rodada do agente (Story 13.5, AC 14 — extraído de `main()` em cli.ts): buscar os
// alvos, abrir o portal, fazer login, ler empresa por empresa (salvando o parcial a cada uma) e
// montar o `NovaExecucaoIss`. Usado pelos dois gatilhos, SEM duplicar login/troca de inscrição/
// extração:
//   - linha de comando (Stories 13.2/13.4): `npm run iss:faturamento [-- --competencia …]`;
//   - solicitação do sistema web (Story 13.5): modo `--vigiar`/`--uma-vez` (vigiar.ts).
//
// Cada chamada abre o SEU navegador e faz o SEU login (AC 18): a sessão do portal não sobrevive
// entre solicitações diferentes. Não envia nada ao sistema — quem chama decide o que fazer com a
// execução (enviar, enviar com `solicitacaoId`, ou só salvar).
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';
import type { AlvoIss, AlvosIssResposta, NovaCapturaIss, NovaExecucaoIss } from '@cobranca/shared';
import type { ConfigAgente } from './config';
import { buscarAlvos as buscarAlvosApi } from './api-client';
import { criarDiagnostico as criarDiagnosticoPadrao, redigirCpf } from './diagnostico';
import {
  ErroComunicadoPendente,
  ErroEmpresaNaoEncontrada,
  ErroLogin,
  PortalIss,
  type Diagnostico,
  type EmpresaSelecionada,
  type LeituraCompetencia,
} from './portal/portal';
import { montarExecucao, type ResultadoEmpresa } from './relatorio';

export const VERSAO_AGENTE = '0.1.0';

/** O que a rodada usa do portal — o `PortalIss` real, ou um dublê nos testes. */
export interface PortalParaExecucao {
  login(cpf: string, senha: string): Promise<void>;
  sessaoPerdida(): boolean;
  recuperar(cpf: string, senha: string): Promise<void>;
  selecionarEmpresa(documento: string): Promise<EmpresaSelecionada>;
  lerCompetencia(competencia: string): Promise<LeituraCompetencia>;
}

export interface NavegadorAberto {
  page: Page;
  fechar(): Promise<void>;
}

/** Pontos de contato com o mundo de fora — todos trocáveis nos testes. */
export interface DependenciasExecucao {
  abrirNavegador(headed: boolean): Promise<NavegadorAberto>;
  criarPortal(page: Page, diag: Diagnostico): PortalParaExecucao;
  buscarAlvos(sistemaUrl: string, token: string, competencia: string): Promise<AlvosIssResposta>;
  criarDiagnostico(pastaExecucao: string, cpf: string, reconhecer: boolean): Diagnostico;
  /** Ritmo de uso humano entre empresas. */
  esperar(ms: number): Promise<void>;
  agora(): Date;
  maquina(): string;
  /** Registra o que fazer no Ctrl+C; devolve a função que desfaz o registro. */
  aoInterromper(tratar: () => void): () => void;
}

async function abrirNavegadorPadrao(headed: boolean): Promise<NavegadorAberto> {
  const { chromium } = await import('playwright');
  const browser = await chromium
    .launch({ channel: 'chrome', headless: !headed })
    .catch(() => chromium.launch({ headless: !headed })); // sem Chrome instalado: Chromium do Playwright
  try {
    const context = await browser.newContext({ locale: 'pt-BR', acceptDownloads: false, viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    return { page, fechar: () => browser.close() };
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}

export const dependenciasPadrao: DependenciasExecucao = {
  abrirNavegador: abrirNavegadorPadrao,
  criarPortal: (page, diag) => new PortalIss(page, diag),
  buscarAlvos: buscarAlvosApi,
  criarDiagnostico: criarDiagnosticoPadrao,
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  agora: () => new Date(),
  maquina: () => hostname(),
  aoInterromper: (tratar) => {
    process.once('SIGINT', tratar);
    return () => process.off('SIGINT', tratar);
  },
};

export interface ProgressoExecucao {
  /** Empresas já lidas (0 = ainda não começou — avisado logo depois de conhecer os alvos). */
  atual: number;
  total: number;
  /** A empresa que acabou de ser lida (ausente no aviso inicial). */
  alvo?: AlvoIss;
  captura?: NovaCapturaIss;
}

export interface OpcoesExecucaoCompetencia {
  competencia: string;
  /** Filtra os alvos por CPF/CNPJ (só dígitos). Vazio = todos. */
  documentos: string[];
  /**
   * Chamado com 0/total antes de abrir o portal e a cada empresa lida. Se LANÇAR, a rodada para
   * (o parcial já está salvo) — é assim que o modo vigiar interrompe uma solicitação cancelada.
   */
  onProgresso?: (progresso: ProgressoExecucao) => void | Promise<void>;
  config: ConfigAgente;
  limite?: number | null;
  headed?: boolean;
  reconhecer?: boolean;
  /** Não fala com o sistema: alvos vêm de `documentos`, com id fictício. */
  offline?: boolean;
  /** Última palavra antes de abrir o portal (modo assistente). `false` = não abre. */
  confirmarInicio?: (quantidade: number) => Promise<boolean>;
  dependencias?: Partial<DependenciasExecucao>;
}

export interface ResultadoExecucaoCompetencia {
  /** `null` quando não houve o que ler (nenhum alvo, ou o operador não confirmou). */
  execucao: NovaExecucaoIss | null;
  motivoSemExecucao: 'sem_alvos' | 'nao_confirmado' | null;
  resultados: ResultadoEmpresa[];
  pastaExecucao: string;
  arquivoJson: string;
  /** Avisos já logados (clientes sem documento, documentos fora da carteira). */
  avisos: string[];
}

function carimbo(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function capturaBase(alvo: AlvoIss, agora: Date): Omit<NovaCapturaIss, 'status'> {
  return {
    clienteContabilidadeId: alvo.clienteContabilidadeId,
    valorServicosPrestados: null,
    quantidadeNotas: null,
    situacaoIss: null,
    competenciaFechada: null,
    inscricaoMunicipal: null,
    razaoSocialIss: null,
    mensagemErro: null,
    capturadoEm: agora.toISOString(),
  };
}

export async function executarCompetencia(opcoes: OpcoesExecucaoCompetencia): Promise<ResultadoExecucaoCompetencia> {
  const deps: DependenciasExecucao = { ...dependenciasPadrao, ...opcoes.dependencias };
  const { competencia, config: cfg } = opcoes;
  const documentos = opcoes.documentos;

  const pastaExecucao = join(cfg.pastaBase, 'execucoes', `${carimbo(deps.agora())}-${competencia}`);
  mkdirSync(pastaExecucao, { recursive: true });
  const arquivoJson = join(pastaExecucao, 'execucao.json');
  const diag = deps.criarDiagnostico(pastaExecucao, cfg.issCpf, opcoes.reconhecer ?? false);
  diag.log(`Agente ISS v${VERSAO_AGENTE} — competência ${competencia} — saída em ${pastaExecucao}`);
  const avisos: string[] = [];
  const avisar = (msg: string) => {
    avisos.push(msg);
    diag.log(msg);
  };

  // 1. Alvos (no --offline, vêm dos documentos; o id é fictício porque nada vai ao sistema)
  const resposta: AlvosIssResposta = opcoes.offline
    ? {
        competencia,
        alvos: documentos.map((documento) => ({
          clienteContabilidadeId: '00000000-0000-0000-0000-000000000000',
          nome: documento,
          documento,
        })),
        semDocumento: [],
      }
    : await deps.buscarAlvos(cfg.sistemaUrl, cfg.token, competencia);
  if (opcoes.offline) diag.log('Modo --offline: nada será enviado ao sistema.');
  let alvos = resposta.alvos;
  if (documentos.length) {
    alvos = alvos.filter((a) => documentos.includes(a.documento));
    const faltam = documentos.filter((d) => !resposta.alvos.some((a) => a.documento === d));
    if (faltam.length) avisar(`Aviso: não são clientes ativos em faixa de faturamento: ${faltam.join(', ')}`);
  }
  if (opcoes.limite) alvos = alvos.slice(0, opcoes.limite);
  if (resposta.semDocumento.length) {
    avisar(
      `Aviso: ${resposta.semDocumento.length} cliente(s) sem CPF/CNPJ no cadastro — não dá para buscar no portal: ` +
        resposta.semDocumento.map((s) => s.nome).join('; '),
    );
  }
  const semExecucao = (motivo: 'sem_alvos' | 'nao_confirmado'): ResultadoExecucaoCompetencia => ({
    execucao: null,
    motivoSemExecucao: motivo,
    resultados: [],
    pastaExecucao,
    arquivoJson,
    avisos,
  });
  if (alvos.length === 0) {
    diag.log('Nenhuma empresa para buscar.');
    return semExecucao('sem_alvos');
  }
  diag.log(`${alvos.length} empresa(s) para buscar.`);
  if (opcoes.confirmarInicio && !(await opcoes.confirmarInicio(alvos.length))) {
    diag.log('Cancelado pelo operador antes de abrir o portal.');
    return semExecucao('nao_confirmado');
  }
  await opcoes.onProgresso?.({ atual: 0, total: alvos.length });

  // 2. Portal
  const iniciadoEm = deps.agora();
  // QA 13.4/13.5: uma chave por execução — reenviar este JSON nunca duplica no sistema.
  const chaveIdempotencia = randomUUID();
  const resultados: ResultadoEmpresa[] = [];
  const salvar = () => {
    const execucao = montarExecucao({
      competencia,
      iniciadoEm,
      finalizadoEm: deps.agora(),
      maquina: deps.maquina(),
      versaoAgente: VERSAO_AGENTE,
      resultados,
      chaveIdempotencia,
    });
    writeFileSync(arquivoJson, JSON.stringify(execucao, null, 2));
    return execucao;
  };

  let navegador: NavegadorAberto | null = null;
  const desfazerInterrupcao = deps.aoInterromper(() => {
    diag.log('Interrompido (Ctrl+C) — salvando o que já foi lido, SEM enviar.');
    if (resultados.length) salvar();
    void navegador?.fechar();
    process.exit(130);
  });

  try {
    navegador = await deps.abrirNavegador(opcoes.headed ?? false);
    const page = navegador.page;
    const portal = deps.criarPortal(page, diag);
    await portal.login(cfg.issCpf, cfg.issSenha);

    for (const [i, alvo] of alvos.entries()) {
      diag.log(`(${i + 1}/${alvos.length}) ${alvo.nome} — ${alvo.documento}`);
      let captura: NovaCapturaIss | null = null;
      for (let tentativa = 1; tentativa <= 2 && !captura; tentativa += 1) {
        try {
          if (portal.sessaoPerdida()) await portal.recuperar(cfg.issCpf, cfg.issSenha);
          const empresa = await portal.selecionarEmpresa(alvo.documento);
          const leitura = await portal.lerCompetencia(competencia);
          const base = {
            ...capturaBase(alvo, deps.agora()),
            inscricaoMunicipal: empresa.inscricao,
            razaoSocialIss: empresa.razaoSocial,
          };
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
            captura = { ...capturaBase(alvo, deps.agora()), status: 'nao_encontrado', mensagemErro: e.message };
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
          captura = { ...capturaBase(alvo, deps.agora()), status: 'erro', mensagemErro: msg };
          await portal.recuperar(cfg.issCpf, cfg.issSenha).catch(() => undefined);
        }
      }
      const c = captura ?? { ...capturaBase(alvo, deps.agora()), status: 'erro' as const, mensagemErro: 'Sem resultado' };
      resultados.push({ nome: alvo.nome, documento: alvo.documento, captura: c });
      diag.log(
        `  → ${c.status}${c.status === 'capturado' ? ` R$ ${c.valorServicosPrestados?.toFixed(2)} (${c.situacaoIss})` : c.mensagemErro ? `: ${c.mensagemErro}` : ''}`,
      );
      salvar(); // parcial a cada empresa: queda no meio não perde o que já foi lido
      await opcoes.onProgresso?.({ atual: i + 1, total: alvos.length, alvo, captura: c });
      await deps.esperar(500); // ritmo de uso humano
    }
  } finally {
    desfazerInterrupcao();
    await navegador?.fechar().catch(() => undefined);
  }

  // 3. Resultado
  return { execucao: salvar(), motivoSemExecucao: null, resultados, pastaExecucao, arquivoJson, avisos };
}
