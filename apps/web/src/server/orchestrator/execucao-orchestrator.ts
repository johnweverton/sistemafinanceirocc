// Execucao Orchestrator — cria a execução, divide os médicos ativos em lotes encadeados,
// processa lote a lote (Integration Client + Engine + repositório) e encadeia o próximo lote
// via chamada HTTP interna. Architecture: Core Workflows + Backend Architecture.
//
// Calibrado para 120 médicos/competência (volume real): BATCH_SIZE = 20 → ~6 lotes,
// pior caso ~30s por lote, dentro do maxDuration de 60s do plano Vercel Pro.
//
// As dependências de I/O (banco, rede, encadeamento HTTP) são injetáveis para permitir
// teste unitário com mocks sem tocar Supabase nem a API da Carmem.
import type { Execucao, Medico, Procedimento, ResultadoMedico } from '@cobranca/shared';
import { processarMedico } from '@/server/engine';
import { buscarProcedimentos, listarCpfsComProcedimentos } from '@/server/integration/procedimentos-client';
import {
  contarMedicosAtivos,
  listarMedicosAtivosPagina,
  descobrirMedicos,
  type MedicoDescoberto,
} from '@/server/repositories/medico-repository';
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
} from '@/server/repositories/execucao-repository';
import { getServerEnv } from '@/lib/env';

/** Médicos por lote — pior caso ~30s, dentro do maxDuration de 60s (architecture). */
export const BATCH_SIZE = 20;

export interface OrchestratorDeps {
  contarMedicosAtivos: () => Promise<number>;
  listarMedicosAtivosPagina: (offset: number, limite: number) => Promise<Medico[]>;
  criarExecucao: (competencia: string, iniciadoPor: string, total: number) => Promise<Execucao>;
  buscarExecucao: (id: string) => Promise<Execucao | null>;
  contarResultados: (execucaoId: string) => Promise<number>;
  gravarResultado: (execucaoId: string, medicoId: string | null, r: ResultadoMedico) => Promise<void>;
  atualizarProgresso: (execucaoId: string, progresso: number) => Promise<void>;
  concluirExecucao: (
    execucaoId: string,
    totais: { totalOk: number; totalAlerta: number; totalSemDados: number; totalGeralValor: number },
  ) => Promise<void>;
  marcarErro: (execucaoId: string) => Promise<void>;
  guiasExecucaoAnterior: (cpf: string, competenciaAtual: string) => Promise<number | null>;
  buscarProcedimentos: (cpf: string, competencia: string) => Promise<Procedimento[]>;
  /** Resultados já gravados — usado para agregar os totais ao concluir. */
  listarResultados: (execucaoId: string) => Promise<ResultadoMedico[]>;
  /** Encadeia o próximo lote (HTTP interno). Pode ser no-op em teste. */
  agendarProximoLote: (execucaoId: string) => Promise<void>;
  /**
   * Fase de descoberta: lista CPFs da API da Carmem para a competência e cria stubs
   * para os que ainda não existem localmente. Retorna quantos stubs foram criados.
   * Falha silenciosa — a execução segue mesmo sem descobrir novos médicos.
   */
  descobrirMedicos: (competencia: string) => Promise<number>;
  batchSize: number;
}

/** Dependências reais (produção). */
export function depsPadrao(): OrchestratorDeps {
  return {
    contarMedicosAtivos,
    listarMedicosAtivosPagina,
    criarExecucao,
    buscarExecucao,
    contarResultados,
    gravarResultado,
    atualizarProgresso,
    concluirExecucao,
    marcarErro,
    guiasExecucaoAnterior,
    buscarProcedimentos,
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
    descobrirMedicos: async (competencia: string): Promise<number> => {
      try {
        const cpfs: MedicoDescoberto[] = await listarCpfsComProcedimentos(competencia);
        return await descobrirMedicos(cpfs);
      } catch {
        return 0; // descoberta falhou — execução segue com médicos já cadastrados
      }
    },
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
  usuarioId: string,
  deps: OrchestratorDeps = depsPadrao(),
): Promise<Execucao> {
  // Fase de descoberta: cria stubs para médicos novos antes de contar o total.
  // Silenciosa — falha não bloqueia a execução.
  try { await deps.descobrirMedicos(competencia); } catch { /* segue sem descoberta */ }

  const total = await deps.contarMedicosAtivos();
  return deps.criarExecucao(competencia, usuarioId, total);
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

  const medicos = await deps.listarMedicosAtivosPagina(jaProcessados, deps.batchSize);

  for (const medico of medicos) {
    await processarUmMedico(execucaoId, execucao.competencia, medico, deps);
  }

  const processadosAgora = jaProcessados + medicos.length;
  const progresso = calcularProgresso(processadosAgora, total);
  await deps.atualizarProgresso(execucaoId, progresso);

  const concluido = processadosAgora >= total;
  if (concluido) {
    await finalizar(execucaoId, deps);
    return { concluido: true, processadosNoLote: medicos.length, progresso: 100 };
  }

  // Encadeia o próximo lote (HTTP interno). Não bloqueia a resposta deste lote.
  await deps.agendarProximoLote(execucaoId);
  return { concluido: false, processadosNoLote: medicos.length, progresso };
}

/** Processa um médico isolando falhas de rede (vira alerta, não derruba o lote). */
async function processarUmMedico(
  execucaoId: string,
  competencia: string,
  medico: Medico,
  deps: OrchestratorDeps,
): Promise<void> {
  try {
    // cpf ?? '': médico importado pode não ter CPF (Épico 5 §3.4); no fluxo atual (pré-cutover)
    // esses médicos têm necessita_configuracao=true e não chegam aqui — o fallback é defensivo.
    const procedimentos = await deps.buscarProcedimentos(medico.cpf ?? '', competencia);
    // Variação anômala (PRD §8.5): busca guias da execução concluída anterior.
    const historicoGuias = await deps.guiasExecucaoAnterior(medico.cpf ?? '', competencia);
    const resultado = processarMedico({ medico, procedimentos, historicoGuias });
    await deps.gravarResultado(execucaoId, medico.id, resultado);
  } catch (e) {
    // Falha de infraestrutura ao buscar dados — médico vira alerta, competência segue.
    await deps.gravarResultado(execucaoId, medico.id, {
      cpf: medico.cpf ?? '',
      nome: medico.nome,
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
