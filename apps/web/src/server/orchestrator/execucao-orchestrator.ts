// Execucao Orchestrator — cria a execução, divide os médicos ativos em lotes encadeados,
// processa lote a lote (Integration Client + Engine + repositório) e encadeia o próximo lote
// via chamada HTTP interna. Architecture: Core Workflows + Backend Architecture.
//
// Calibrado para 120 médicos/competência (volume real): BATCH_SIZE = 20 → ~6 lotes,
// pior caso ~30s por lote, dentro do maxDuration de 60s do plano Vercel Pro.
//
// As dependências de I/O (banco, rede, encadeamento HTTP) são injetáveis para permitir
// teste unitário com mocks sem tocar Supabase nem a API da Carmem.
import type { Execucao, Medico, ItemProducao, ResultadoMedico } from '@cobranca/shared';
import { processarMedico } from '@/server/engine';
import { buscarItens } from '@/server/integration/fin-api-client';
import { buscarMedico, listarMedicosPorIds } from '@/server/repositories/medico-repository';
import {
  criarExecucao,
  buscarExecucao,
  contarResultados,
  gravarResultado,
  atualizarProgresso,
  concluirExecucao,
  marcarErro,
  guiasExecucaoAnterior,
  listarResultados,
  listarSelecoes,
} from '@/server/repositories/execucao-repository';
import { lerValorConsultaPediatria } from '@/server/repositories/config-cobranca-repository';
import { getServerEnv } from '@/lib/env';
import { ApiError } from '@/lib/api-error';

/** Médicos por lote — pior caso ~30s, dentro do maxDuration de 60s (architecture). */
export const BATCH_SIZE = 20;

export interface SelecaoDeps {
  execucaoId: string;
  medicoId: string;
  producaoExternaId: string;
  producaoNome: string;
  /** Produção de consultas de pediatria (Story 10.2) — opcional. */
  producaoConsultasExternaId?: string | null;
  producaoConsultasNome?: string | null;
}

export interface OrchestratorDeps {
  listarSelecoes: (execucaoId: string) => Promise<SelecaoDeps[]>;
  buscarMedico: (id: string) => Promise<Medico | null>;
  listarMedicosPorIds: (ids: string[]) => Promise<Medico[]>;
  criarExecucao: (
    competencia: string,
    iniciadoPor: string,
    selecoes: {
      medicoId: string;
      producaoExternaId: string;
      producaoNome: string;
      producaoConsultasExternaId?: string | null;
      producaoConsultasNome?: string | null;
    }[],
  ) => Promise<Execucao>;
  buscarExecucao: (id: string) => Promise<Execucao | null>;
  contarResultados: (execucaoId: string) => Promise<number>;
  gravarResultado: (execucaoId: string, medicoId: string | null, r: ResultadoMedico) => Promise<void>;
  atualizarProgresso: (execucaoId: string, progresso: number) => Promise<void>;
  concluirExecucao: (
    execucaoId: string,
    totais: { totalOk: number; totalAlerta: number; totalSemDados: number; totalGeralValor: number },
  ) => Promise<void>;
  marcarErro: (execucaoId: string) => Promise<void>;
  guiasExecucaoAnterior: (medicoId: string, competenciaAtual: string) => Promise<number | null>;
  buscarItens: (producaoExternaId: string) => Promise<ItemProducao[]>;
  /** Valor unitário global da consulta pediátrica (Story 10.2), lido de config_cobranca. */
  lerValorConsultaPediatria: () => Promise<number>;
  /** Resultados já gravados — usado para agregar os totais ao concluir. */
  listarResultados: (execucaoId: string) => Promise<ResultadoMedico[]>;
  /** Encadeia o próximo lote (HTTP interno). Pode ser no-op em teste. */
  agendarProximoLote: (execucaoId: string) => Promise<void>;
  batchSize: number;
}

/** Dependências reais (produção). */
export function depsPadrao(): OrchestratorDeps {
  return {
    listarSelecoes,
    buscarMedico,
    listarMedicosPorIds,
    criarExecucao,
    buscarExecucao,
    contarResultados,
    gravarResultado,
    atualizarProgresso,
    concluirExecucao,
    marcarErro,
    guiasExecucaoAnterior,
    buscarItens,
    lerValorConsultaPediatria,
    listarResultados: async (id) =>
      (await listarResultados(id)).map((r) => ({
        cpf: r.cpf,
        nome: r.nome,
        procedimentos: r.procedimentos ?? 0,
        cirurgias: r.cirurgias ?? 0,
        guias: r.guias ?? 0,
        guiasConsolidado: r.guiasConsolidado ?? 0,
        subtotais: r.subtotais ?? [],
        totalValor: r.totalValor ?? 0,
        status: r.status,
        alertas: r.alertas,
      })),
    agendarProximoLote: agendarProximoLoteHttp,
    batchSize: BATCH_SIZE,
  };
}

/**
 * Lógica pura de divisão em lotes: quantos lotes para um total dado um tamanho de lote.
 * Exportada para teste unitário direto (sem I/O).
 */
export function numeroDeLotes(total: number, batchSize: number): number {
  if (total <= 0) return 0;
  return Math.ceil(total / batchSize);
}

/** Calcula o progresso (0-100) a partir de quantos médicos já foram processados. */
export function calcularProgresso(processados: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, Math.round((processados / total) * 100));
}

/**
 * Cria a execução e dispara o primeiro lote (fire-and-forget no caller).
 * Responde imediatamente — não espera o processamento (PRD §6.3).
 */
export async function iniciarExecucao(
  competencia: string,
  selecoes: {
    medicoId: string;
    producaoExternaId: string;
    producaoNome: string;
    producaoConsultasExternaId?: string | null;
    producaoConsultasNome?: string | null;
  }[],
  usuarioId: string,
  deps: OrchestratorDeps = depsPadrao(),
): Promise<Execucao> {
  // QA M-1: validação server-side das seleções (defesa em profundidade — a UI já filtra,
  // mas o invariante da 0005 não pode depender só dela). Médico precisa existir, estar
  // ativo, configurado e vinculado à origem; medicoId duplicado é rejeitado.
  const ids = selecoes.map((s) => s.medicoId);
  const duplicados = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (duplicados.length > 0) {
    throw new ApiError(422, 'Seleções duplicadas para o mesmo médico', 'SELECAO_DUPLICADA', {
      medicoIds: duplicados,
    });
  }

  const medicos = await deps.listarMedicosPorIds(ids);
  const porId = new Map(medicos.map((m) => [m.id, m]));
  const invalidos: string[] = [];
  for (const s of selecoes) {
    const m = porId.get(s.medicoId);
    if (!m) invalidos.push(`${s.medicoId}: médico não encontrado`);
    else if (!m.ativo) invalidos.push(`${m.nome}: inativo`);
    else if (m.necessitaConfiguracao) invalidos.push(`${m.nome}: cadastro pendente de configuração`);
    else if (!m.externalId) invalidos.push(`${m.nome}: sem vínculo com o sistema web`);
  }
  if (invalidos.length > 0) {
    throw new ApiError(422, 'Seleções inválidas para execução', 'SELECAO_INVALIDA', { invalidos });
  }

  return deps.criarExecucao(competencia, usuarioId, selecoes);
}

export interface ResultadoLote {
  concluido: boolean;
  processadosNoLote: number;
  progresso: number;
}

/**
 * Processa o próximo lote de médicos ativos. O cursor é "quantos resultados já existem".
 * Uma falha de rede num médico não trava a competência: vira alerta e segue (architecture).
 * Quando não há mais médicos, agrega os totais e conclui. Senão, agenda o próximo lote.
 */
export async function processarProximoLote(
  execucaoId: string,
  deps: OrchestratorDeps = depsPadrao(),
): Promise<ResultadoLote> {
  const execucao = await deps.buscarExecucao(execucaoId);
  if (!execucao) throw new Error(`Execução ${execucaoId} não encontrada`);

  const total = execucao.totalMedicos ?? 0;
  const jaProcessados = await deps.contarResultados(execucaoId);

  // Sem médicos, ou já processou todos → conclui.
  if (total === 0 || jaProcessados >= total) {
    await finalizar(execucaoId, deps);
    return { concluido: true, processadosNoLote: 0, progresso: 100 };
  }

  const todasSelecoes = await deps.listarSelecoes(execucaoId);
  const selecoesLote = todasSelecoes.slice(jaProcessados, jaProcessados + deps.batchSize);

  // Lido uma vez por lote (não por médico) — config global, singleton (Story 10.2).
  const valorConsultaPediatria = await deps.lerValorConsultaPediatria();

  for (const selecao of selecoesLote) {
    await processarUmMedico(execucaoId, execucao.competencia, selecao, deps, valorConsultaPediatria);
  }

  const processadosAgora = jaProcessados + selecoesLote.length;
  const progresso = calcularProgresso(processadosAgora, total);
  await deps.atualizarProgresso(execucaoId, progresso);

  const concluido = processadosAgora >= total;
  if (concluido) {
    await finalizar(execucaoId, deps);
    return { concluido: true, processadosNoLote: selecoesLote.length, progresso: 100 };
  }

  // Encadeia o próximo lote (HTTP interno). Não bloqueia a resposta deste lote.
  await deps.agendarProximoLote(execucaoId);
  return { concluido: false, processadosNoLote: selecoesLote.length, progresso };
}

/** Processa um médico isolando falhas de rede (vira alerta, não derruba o lote). */
async function processarUmMedico(
  execucaoId: string,
  competencia: string,
  selecao: SelecaoDeps,
  deps: OrchestratorDeps,
  valorConsultaPediatria: number,
): Promise<void> {
  let medico: Medico | null = null;
  try {
    medico = await deps.buscarMedico(selecao.medicoId);
    if (!medico) throw new Error('Médico não encontrado na base');

    const itens = await deps.buscarItens(selecao.producaoExternaId);
    // Story 10.2: lote separado de consultas ambulatoriais (pediatria) — opcional, produção
    // distinta da de guias. NUNCA reaproveita `itens` (anti-dupla-contagem).
    const itensConsultas = selecao.producaoConsultasExternaId
      ? await deps.buscarItens(selecao.producaoConsultasExternaId)
      : undefined;

    // Variação anômala (PRD §8.5): busca guias da execução concluída anterior.
    const historicoGuias = await deps.guiasExecucaoAnterior(medico.id, competencia);
    const resultado = processarMedico(
      { medico, itens, historicoGuias, itensConsultas },
      undefined,
      valorConsultaPediatria,
    );
    await deps.gravarResultado(execucaoId, medico.id, resultado);
  } catch (e) {
    // Falha de infraestrutura ao buscar dados — médico vira alerta, competência segue.
    await deps.gravarResultado(execucaoId, selecao.medicoId, {
      cpf: medico?.cpf ?? '',
      nome: medico?.nome ?? 'Médico Desconhecido',
      procedimentos: 0,
      cirurgias: 0,
      guias: 0,
      guiasConsolidado: 0,
      subtotais: [],
      totalValor: 0,
      status: 'alerta',
      alertas: [`Falha ao buscar dados — tentar novamente. (${String(e)})`],
    });
  }
}

async function finalizar(execucaoId: string, deps: OrchestratorDeps): Promise<void> {
  const resultados = await deps.listarResultados(execucaoId);
  const totais = resultados.reduce(
    (acc, r) => {
      if (r.status === 'ok') acc.totalOk += 1;
      else if (r.status === 'alerta') acc.totalAlerta += 1;
      else acc.totalSemDados += 1;
      acc.totalGeralValor += r.totalValor;
      return acc;
    },
    { totalOk: 0, totalAlerta: 0, totalSemDados: 0, totalGeralValor: 0 },
  );
  await deps.concluirExecucao(execucaoId, totais);
}

/** Encadeamento real do próximo lote via HTTP interno protegido por X-Internal-Secret. */
async function agendarProximoLoteHttp(execucaoId: string): Promise<void> {
  const env = getServerEnv();
  if (!env.INTERNAL_SECRET || !env.APP_BASE_URL) {
    // Sem configuração de encadeamento — não pode auto-invocar. Lança para virar 'erro'.
    throw new Error('INTERNAL_SECRET/APP_BASE_URL não configurados para encadear lotes');
  }
  const url = new URL(`/api/execucoes/${execucaoId}/processar-lote`, env.APP_BASE_URL);
  // Fire-and-forget: dispara o próximo lote sem aguardar sua conclusão.
  void fetch(url, {
    method: 'POST',
    headers: { 'X-Internal-Secret': env.INTERNAL_SECRET },
  }).catch(() => {
    /* erro de encadeamento é registrado pelo próprio lote seguinte ao falhar */
  });
}

/** Helper para o Route Handler de disparo: marca erro se o primeiro lote estourar. */
export async function dispararPrimeiroLote(
  execucaoId: string,
  deps: OrchestratorDeps = depsPadrao(),
): Promise<void> {
  try {
    await processarProximoLote(execucaoId, deps);
  } catch {
    await deps.marcarErro(execucaoId);
  }
}
