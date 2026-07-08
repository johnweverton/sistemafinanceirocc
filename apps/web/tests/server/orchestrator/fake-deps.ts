import type { Execucao, Medico, ItemProducao, ResultadoMedico } from '@cobranca/shared';
import type { OrchestratorDeps } from '../../../src/server/orchestrator/execucao-orchestrator';

export interface FakeState {
  execucoes: Map<string, Execucao>;
  resultados: Map<string, { medicoId: string | null; r: ResultadoMedico }[]>;
  medicos: Map<string, Medico>;
  selecoes: { execucaoId: string; medicoId: string; producaoExternaId: string; producaoNome: string }[];
  itensPorProducao: Record<string, ItemProducao[]>;
  guiasAnterioresPorMedicoId: Record<string, number | null>;
  chamadasProximoLote: number;
  /** Se setado, buscarItens lança para essas producoes (simula falha de rede). */
  producoesComFalha: Set<string>;
}

export function novoEstado(medicos: Medico[]): FakeState {
  const medicosMap = new Map<string, Medico>();
  for (const m of medicos) medicosMap.set(m.id, m);
  
  return {
    execucoes: new Map(),
    resultados: new Map(),
    medicos: medicosMap,
    selecoes: [],
    itensPorProducao: {},
    guiasAnterioresPorMedicoId: {},
    chamadasProximoLote: 0,
    producoesComFalha: new Set(),
  };
}

export function medicoFake(over: Partial<Medico> & { id: string; cpf: string; nome: string }): Medico {
  return {
    especialidade: null,
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    colaboradorResponsavel: null,
    ativo: true,
    necessitaConfiguracao: false,
    // Vinculado por padrão — a validação de seleções (QA M-1) exige externalId.
    externalId: `ext-${over.id}`,
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
    listarSelecoes: async (execucaoId) => state.selecoes.filter(s => s.execucaoId === execucaoId),
    buscarMedico: async (id) => state.medicos.get(id) ?? null,
    listarMedicosPorIds: async (ids) =>
      ids.map((id) => state.medicos.get(id)).filter((m): m is Medico => m != null),
    criarExecucao: async (competencia, iniciadoPor, selecoes) => {
      const id = `exec-${proximoId++}`;
      const exec: Execucao = {
        id,
        competencia,
        iniciadoPor,
        iniciadoEm: new Date().toISOString(),
        finalizadoEm: null,
        status: 'processando',
        progresso: 0,
        totalMedicos: selecoes.length,
        totalOk: null,
        totalAlerta: null,
        totalSemDados: null,
        totalGeralValor: null,
      };
      state.execucoes.set(id, exec);
      state.resultados.set(id, []);
      
      // Store selecoes for this execution
      for (const s of selecoes) {
        state.selecoes.push({ ...s, execucaoId: id });
      }
      
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
    guiasExecucaoAnterior: async (medicoId) => state.guiasAnterioresPorMedicoId[medicoId] ?? null,
    buscarItens: async (producaoExternaId) => {
      if (state.producoesComFalha.has(producaoExternaId)) throw new Error('falha de rede simulada');
      return state.itensPorProducao[producaoExternaId] ?? [];
    },
    listarResultados: async (id) => (state.resultados.get(id) ?? []).map((x) => x.r),
    agendarProximoLote: async (id) => {
      state.chamadasProximoLote += 1;
      if (opts.autoEncadear) {
        await processarProximoLote(id, deps);
      }
    },
  };
  return deps;
}
