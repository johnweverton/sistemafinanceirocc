import type {
  Execucao,
  Empresa,
  Medico,
  ItemProducao,
  ResultadoMedico,
  ExecucaoResultado,
  ClienteContabilidade,
  ClienteContabilidadeFaturamento,
} from '@cobranca/shared';
import type { OrchestratorDeps } from '../../../src/server/orchestrator/execucao-orchestrator';
import type { SaldoAcumuladoPersistido } from '../../../src/server/repositories/saldo-acumulado-repository';

export interface ResultadoEmpresaFake {
  id: string;
  empresaId: string;
  nome: string;
  guias: number;
  totalValor: number;
  status: ExecucaoResultado['status'];
  alertas: string[];
  subtotalFaixa: string;
}

export interface ResultadoClienteContabilidadeFake {
  id: string;
  execucaoId: string;
  clienteContabilidadeId: string;
  nome: string;
  totalValor: number;
  status: ExecucaoResultado['status'];
  alertas: string[];
  subtotalFaixa: string;
}

export interface FakeState {
  execucoes: Map<string, Execucao>;
  resultados: Map<string, { medicoId: string | null; r: ResultadoMedico }[]>;
  medicos: Map<string, Medico>;
  /** Empresas cadastradas (Story 10.4a/b) — para execuções agregadas. */
  empresas: Map<string, Empresa>;
  /** Resultado agregado por execução (Story 10.4b) — 1 por execução de empresa. */
  resultadosEmpresa: Map<string, ResultadoEmpresaFake>;
  /** Contribuições por médico, chaveadas pelo id do resultado agregado (Story 10.4b). */
  contribuicoes: Map<string, { medicoId: string; guias: number; valor: number }[]>;
  /** Clientes contábeis cadastrados (Story 11.1) — para execuções de cliente contábil. */
  clientesContabilidade: Map<string, ClienteContabilidade>;
  /** Faturamento lançado por cliente contábil, chaveado por `${clienteId}:${competencia}` (Story 11.2). */
  faturamentos: Map<string, ClienteContabilidadeFaturamento>;
  /** Resultado (único) por execução de cliente contábil (Story 11.3). */
  resultadosClienteContabilidade: Map<string, ResultadoClienteContabilidadeFake>;
  selecoes: {
    execucaoId: string;
    medicoId: string;
    producaoExternaId: string | null;
    producaoNome: string | null;
    producaoConsultasExternaId?: string | null;
    producaoConsultasNome?: string | null;
    producaoConsultasLoteExternaIds?: string[] | null;
    producaoConsultasLoteNomes?: string[] | null;
    producaoGuiasLoteExternaIds?: string[] | null;
    producaoGuiasLoteNomes?: string[] | null;
    producaoOutrosHospitaisExternaId?: string | null;
    producaoOutrosHospitaisNome?: string | null;
    producaoImobilizacoesExternaId?: string | null;
    producaoImobilizacoesNome?: string | null;
    producaoCateterExternaIds?: string[] | null;
    producaoCateterNomes?: string[] | null;
    producaoFistulaExternaIds?: string[] | null;
    producaoFistulaNomes?: string[] | null;
    producaoAngiografiaExternaIds?: string[] | null;
    producaoAngiografiaNomes?: string[] | null;
    /** Contagem de guias conferida MANUALMENTE por planilha (migration 0058). */
    guiasManuaisTotal?: number | null;
    /** Mesmo mecanismo acima, por classe (migration 0060, achado 2026-09-04). */
    guiasManuaisConsultas?: number | null;
    guiasManuaisImobilizacoes?: number | null;
    guiasManuaisOutrosHospitais?: number | null;
    guiasManuaisMotivo?: string | null;
  }[];
  itensPorProducao: Record<string, ItemProducao[]>;
  /** Itens por LOTE (Cateter/Fístula/Angiografia do Angiologista) — namespace separado de
   * itensPorProducao, espelhando fin-lotes (loteId) vs fin-producoes (producaoId) na origem. */
  itensPorLote: Record<string, ItemProducao[]>;
  guiasAnterioresPorMedicoId: Record<string, number | null>;
  chamadasProximoLote: number;
  /** Se setado, buscarItens lança para essas producoes (simula falha de rede). */
  producoesComFalha: Set<string>;
  /** Saldo acumulado por médico (achado 2026-08-13) — mesma semântica de `medicos_saldo_acumulado`. */
  saldosAcumulados: Map<string, SaldoAcumuladoPersistido>;
}

export function novoEstado(
  medicos: Medico[],
  empresas: Empresa[] = [],
  clientesContabilidade: ClienteContabilidade[] = [],
): FakeState {
  const medicosMap = new Map<string, Medico>();
  for (const m of medicos) medicosMap.set(m.id, m);
  const empresasMap = new Map<string, Empresa>();
  for (const e of empresas) empresasMap.set(e.id, e);
  const clientesMap = new Map<string, ClienteContabilidade>();
  for (const c of clientesContabilidade) clientesMap.set(c.id, c);

  return {
    execucoes: new Map(),
    resultados: new Map(),
    medicos: medicosMap,
    empresas: empresasMap,
    resultadosEmpresa: new Map(),
    contribuicoes: new Map(),
    clientesContabilidade: clientesMap,
    faturamentos: new Map(),
    resultadosClienteContabilidade: new Map(),
    selecoes: [],
    itensPorProducao: {},
    itensPorLote: {},
    guiasAnterioresPorMedicoId: {},
    chamadasProximoLote: 0,
    producoesComFalha: new Set(),
    saldosAcumulados: new Map(),
  };
}

export function empresaFake(over: Partial<Empresa> & { id: string; nome: string }): Empresa {
  return {
    cobranca: null,
    contaEmissora: 'mc',
    condicoes: null,
    regraPreco: null,
    ativo: true,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

export function clienteContabilidadeFake(
  over: Partial<ClienteContabilidade> & { id: string; nome: string },
): ClienteContabilidade {
  return {
    regimeTributario: 'simples_nacional',
    modoCobranca: 'faixa_faturamento',
    regraPreco: null,
    cobranca: null,
    contaEmissora: 'mc',
    condicoes: null,
    adicionalAtivo: false,
    adicionalValor: null,
    adicionalIntervaloMeses: null,
    adicionalCompetenciaBase: null,
    ativo: true,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

export function medicoFake(over: Partial<Medico> & { id: string; cpf: string; nome: string }): Medico {
  return {
    // Especialidade não-3x1 (1 item = 1 guia). Era `null`, mas desde a auditoria 2026-09-02
    // cadastro sem especialidade gera alerta próprio — cada teste que quiser esse caso passa
    // `especialidade: null` explicitamente.
    especialidade: 'Cirurgia Geral',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    semExcedentePorGuia: false,
    contaEmissora: 'mc',
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
  opts: { autoEncadear?: boolean; valorConsultaPediatria?: number } = {},
): OrchestratorDeps {
  let proximoId = 1;
  const deps: OrchestratorDeps = {
    batchSize,
    lerValorConsultaPediatria: async () => opts.valorConsultaPediatria ?? 3.0,
    listarSelecoes: async (execucaoId) => state.selecoes.filter(s => s.execucaoId === execucaoId),
    buscarMedico: async (id) => state.medicos.get(id) ?? null,
    listarMedicosPorIds: async (ids) =>
      ids.map((id) => state.medicos.get(id)).filter((m): m is Medico => m != null),
    buscarEmpresa: async (id) => state.empresas.get(id) ?? null,
    buscarClienteContabilidade: async (id) => state.clientesContabilidade.get(id) ?? null,
    listarClientesContabilidadePorIds: async (ids) =>
      ids.map((id) => state.clientesContabilidade.get(id)).filter((c): c is ClienteContabilidade => c != null),
    buscarFaturamentoClienteContabilidade: async (clienteId, competencia) =>
      state.faturamentos.get(`${clienteId}:${competencia}`) ?? null,
    criarExecucao: async (competencia, iniciadoPor, selecoes, empresaId, clienteContabilidadeId, ehAdicional, clientesContabilidadeIds) => {
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
        totalAcumulado: null,
        totalGeralValor: null,
        empresaId: empresaId ?? null,
        clienteContabilidadeId: clienteContabilidadeId ?? null,
        ehAdicional: ehAdicional ?? false,
        clientesContabilidadeIds: clientesContabilidadeIds ?? null,
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
      return `resultado-${proximoId++}`;
    },
    gravarResultadoEmpresa: async (execucaoId, empresaId, r) => {
      const resultadoId = `resultado-empresa-${proximoId++}`;
      state.resultadosEmpresa.set(execucaoId, { id: resultadoId, empresaId, ...r });
      return resultadoId;
    },
    gravarContribuicoes: async (resultadoId, contribuicoes) => {
      state.contribuicoes.set(resultadoId, contribuicoes);
    },
    gravarResultadoClienteContabilidade: async (execucaoId, clienteContabilidadeId, r) => {
      const resultadoId = `resultado-cliente-contabilidade-${proximoId++}`;
      state.resultadosClienteContabilidade.set(execucaoId, { id: resultadoId, execucaoId, clienteContabilidadeId, ...r });
      // Espelha no map genérico de resultados (mesma tabela `execucao_resultados` no banco real,
      // onde listarResultados/finalizar leem de forma agnóstica) — necessário pro CÁLCULO EM
      // LOTE (feedback do dono, 2026-08-20), que grava N clientes na MESMA execução e depende de
      // `finalizar` agregar todos eles, não só o último (resultadosClienteContabilidade acima é
      // singular por execução — preservado pro caso singular já existente, não usado no lote).
      const lista = state.resultados.get(execucaoId) ?? [];
      lista.push({
        medicoId: null,
        r: {
          cpf: '',
          nome: r.nome,
          procedimentos: 0,
          cirurgias: 0,
          guias: 0,
          guiasConsolidado: 0,
          subtotais: [],
          totalValor: r.totalValor,
          status: r.status,
          alertas: r.alertas,
        },
      });
      state.resultados.set(execucaoId, lista);
      return resultadoId;
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
        totalAcumulado: totais.totalAcumulado,
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
    buscarItensPorLote: async (loteExternoId) => {
      if (state.producoesComFalha.has(loteExternoId)) throw new Error('falha de rede simulada');
      return state.itensPorLote[loteExternoId] ?? [];
    },
    buscarSaldoAcumulado: async (medicoId) => state.saldosAcumulados.get(medicoId) ?? null,
    gravarSaldoAcumulado: async (medicoId, saldo, competenciaOrigem) => {
      state.saldosAcumulados.set(medicoId, { ...saldo, competenciaOrigem });
    },
    limparSaldoAcumulado: async (medicoId) => {
      state.saldosAcumulados.delete(medicoId);
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
