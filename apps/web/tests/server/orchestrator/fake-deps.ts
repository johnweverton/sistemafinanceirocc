// Harness de teste do Orchestrator: dependências em memória, sem Supabase nem rede.
// Implementa OrchestratorDeps inteiro com estado em arrays/maps.
import type { Execucao, Medico, Procedimento, ResultadoMedico } from '@cobranca/shared';
import type { OrchestratorDeps } from '../../../src/server/orchestrator/execucao-orchestrator';

export interface FakeState {
  execucoes: Map<string, Execucao>;
  resultados: Map<string, { medicoId: string | null; r: ResultadoMedico }[]>;
  medicosAtivos: Medico[];
  procedimentosPorCpf: Record<string, Procedimento[]>;
  guiasAnterioresPorCpf: Record<string, number | null>;
  chamadasProximoLote: number;
  /** CPFs retornados pela fase de descoberta (simula API Carmem). */
  cpfsParaDescobrir: { cpf: string; nome: string; especialidade: string | null }[];
  /** CPFs que foram descobertos/criados como stubs pelo fake. */
  stubsCriados: string[];
  /** Se setado, buscarProcedimentos lança para esses CPFs (simula falha de rede). */
  cpfsComFalha: Set<string>;
}

export function novoEstado(medicos: Medico[]): FakeState {
  return {
    execucoes: new Map(),
    resultados: new Map(),
    medicosAtivos: medicos,
    procedimentosPorCpf: {},
    guiasAnterioresPorCpf: {},
    chamadasProximoLote: 0,
    cpfsParaDescobrir: [],
    stubsCriados: [],
    cpfsComFalha: new Set(),
  };
}

export function medicoFake(over: Partial<Medico> & { id: string; cpf: string; nome: string }): Medico {
  return {
    especialidade: null,
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    colaboradorResponsavel: null,
    ativo: true,
    necessitaConfiguracao: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

/**
 * Monta OrchestratorDeps em memória. `batchSize` permite forçar múltiplos lotes em testes.
 * `autoEncadear` simula o encadeamento real: ao agendar o próximo lote, processa-o já
 * (de forma síncrona) — assim o teste de integração roda a execução inteira.
 */
export function fakeDeps(
  state: FakeState,
  batchSize: number,
  processarProximoLote: (id: string, deps: OrchestratorDeps) => Promise<unknown>,
  opts: { autoEncadear?: boolean } = {},
): OrchestratorDeps {
  let proximoId = 1;
  const deps: OrchestratorDeps = {
    batchSize,
    contarMedicosAtivos: async () => state.medicosAtivos.length,
    listarMedicosAtivosPagina: async (offset, limite) =>
      state.medicosAtivos.slice(offset, offset + limite),
    criarExecucao: async (competencia, iniciadoPor, total) => {
      const id = `exec-${proximoId++}`;
      const exec: Execucao = {
        id,
        competencia,
        iniciadoPor,
        iniciadoEm: new Date().toISOString(),
        finalizadoEm: null,
        status: 'processando',
        progresso: 0,
        totalMedicos: total,
        totalOk: null,
        totalAlerta: null,
        totalSemDados: null,
        totalGeralValor: null,
      };
      state.execucoes.set(id, exec);
      state.resultados.set(id, []);
      return exec;
    },
    buscarExecucao: async (id) => state.execucoes.get(id) ?? null,
    contarResultados: async (id) => state.resultados.get(id)?.length ?? 0,
    gravarResultado: async (id, medicoId, r) => {
      state.resultados.get(id)!.push({ medicoId, r });
    },
    atualizarProgresso: async (id, progresso) => {
      const e = state.execucoes.get(id)!;
      state.execucoes.set(id, { ...e, progresso });
    },
    concluirExecucao: async (id, totais) => {
      const e = state.execucoes.get(id)!;
      state.execucoes.set(id, {
        ...e,
        status: 'concluido',
        progresso: 100,
        finalizadoEm: new Date().toISOString(),
        totalOk: totais.totalOk,
        totalAlerta: totais.totalAlerta,
        totalSemDados: totais.totalSemDados,
        totalGeralValor: totais.totalGeralValor,
      });
    },
    marcarErro: async (id) => {
      const e = state.execucoes.get(id)!;
      state.execucoes.set(id, { ...e, status: 'erro' });
    },
    guiasExecucaoAnterior: async (cpf) => state.guiasAnterioresPorCpf[cpf] ?? null,
    buscarProcedimentos: async (cpf) => {
      if (state.cpfsComFalha.has(cpf)) throw new Error('falha de rede simulada');
      return state.procedimentosPorCpf[cpf] ?? [];
    },
    listarResultados: async (id) => (state.resultados.get(id) ?? []).map((x) => x.r),
    agendarProximoLote: async (id) => {
      state.chamadasProximoLote += 1;
      if (opts.autoEncadear) {
        await processarProximoLote(id, deps);
      }
    },
    descobrirMedicos: async (_competencia) => {
      // Simula descoberta: para cada CPF em cpfsParaDescobrir que ainda não está em
      // medicosAtivos, registra como stub criado (sem alterar medicosAtivos — stubs
      // têm necessitaConfiguracao=true e não entram no processamento).
      const cpfsConhecidos = new Set(state.medicosAtivos.map((m) => m.cpf));
      const novos = state.cpfsParaDescobrir.filter((m) => !cpfsConhecidos.has(m.cpf));
      for (const m of novos) state.stubsCriados.push(m.cpf);
      return novos.length;
    },
  };
  return deps;
}
