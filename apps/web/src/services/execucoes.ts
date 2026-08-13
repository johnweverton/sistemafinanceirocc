import type {
  Execucao,
  ExecucaoResultado,
  ExecucaoResultadoContribuicao,
  ExecucaoResumoMedico,
  ExecucaoHistoricoMedicoItem,
  Medico,
  LoteExterna,
} from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export interface ExecucaoSelecaoPayload {
  medicoId: string;
  /** Null pra médico Angiologista (GATE 2026-08-07) — sem lote principal. */
  producaoExternaId: string | null;
  producaoNome: string | null;
  /** Produção de consultas de pediatria — opcional. */
  producaoConsultasExternaId?: string | null;
  producaoConsultasNome?: string | null;
  /** Lotes separados de Outros Hospitais/Imobilizações — opcionais. */
  producaoOutrosHospitaisExternaId?: string | null;
  producaoOutrosHospitaisNome?: string | null;
  producaoImobilizacoesExternaId?: string | null;
  producaoImobilizacoesNome?: string | null;
  /** Lotes de Cateter/Fístula/Angiografia (médico Angiologista, GATE 2026-08-07) — opcionais. */
  producaoCateterExternaId?: string | null;
  producaoCateterNome?: string | null;
  producaoFistulaExternaId?: string | null;
  producaoFistulaNome?: string | null;
  producaoAngiografiaExternaId?: string | null;
  producaoAngiografiaNome?: string | null;
  /** Carta de Rede (médico Angiologista, GATE 2026-08-12) — contagem MANUAL, sem itens da API. */
  producaoCartaRedeExternaId?: string | null;
  producaoCartaRedeNome?: string | null;
  cartaRedeGuias?: number | null;
}

export interface ApoioData {
  medicos: Medico[];
  clientesOrigem: Array<{
    id: string;
    nome: string;
    producoes: Array<{ id: string; nome: string }>;
  }>;
}

export const execucoesService = {
  apoio: () => apiFetch<ApoioData>('/execucoes/apoio'),
  /**
   * Sub-lotes (Cateter/Fístula/Angiografia/Carta de Rede) dentro da produção MENSAL de um médico
   * Angiologista — endpoint aditivo da origem, buscado sob demanda (GATE 2026-08-13), nunca
   * pré-carregado em `apoio`.
   */
  lotes: (producaoId: string) =>
    apiFetch<{ lotes: LoteExterna[] }>(`/execucoes/lotes?producaoId=${producaoId}`),
  /**
   * `empresaId` marca a execução como agregada por empresa; `clienteContabilidadeId` marca como
   * execução de cliente contábil; `ehAdicional` marca como o boleto avulso do adicional
   * semestral (só válido com `clienteContabilidadeId`).
   */
  disparar: (
    competencia: string,
    selecoes: ExecucaoSelecaoPayload[],
    empresaId?: string,
    clienteContabilidadeId?: string,
    ehAdicional?: boolean,
  ) =>
    apiFetch<{ execucaoId: string }>('/execucoes', {
      method: 'POST',
      body: JSON.stringify({
        competencia,
        selecoes,
        ...(empresaId ? { empresaId } : {}),
        ...(clienteContabilidadeId ? { clienteContabilidadeId } : {}),
        ...(ehAdicional ? { ehAdicional } : {}),
      }),
    }),
  listar: () => apiFetch<Execucao[]>('/execucoes'),
  detalhe: (id: string) => apiFetch<Execucao>(`/execucoes/${id}`),
  /** Retoma manualmente uma execução travada em "processando" (encadeamento entre lotes falhou). */
  retomar: (id: string) => apiFetch<{ ok: true }>(`/execucoes/${id}/retomar`, { method: 'POST' }),
  resultados: (id: string) => apiFetch<ExecucaoResultado[]>(`/execucoes/${id}/resultados`),
  /** Auditoria "qual médico contribuiu quanto" de um resultado agregado. */
  contribuicoes: (resultadoId: string) =>
    apiFetch<ExecucaoResultadoContribuicao[]>(`/execucoes/resultados/${resultadoId}/contribuicoes`),
  revisarResultado: (execucaoId: string, resultadoId: string, motivo: string) =>
    apiFetch<{ resultado: ExecucaoResultado }>(
      `/execucoes/${execucaoId}/resultados/${resultadoId}/revisar`,
      { method: 'POST', body: JSON.stringify({ motivo }) },
    ),
  /** Reprocessa um resultado já gravado com os itens de produção ATUAIS da origem — para quando
   *  o dado foi corrigido no sistema de origem depois que a execução já rodou. Bloqueado se o
   *  resultado já tiver boleto emitido. */
  recalcularResultado: (resultadoId: string) =>
    apiFetch<{ resultado: ExecucaoResultado }>(
      `/execucoes/resultados/${resultadoId}/recalcular`,
      { method: 'POST' },
    ),
  resumoPorMedico: () => apiFetch<ExecucaoResumoMedico[]>('/execucoes/por-medico'),
  /** Médicos com boleto ativo (emitido/pago) já na competência informada, em qualquer execução
   *  — usado pra não deixar reemitir boleto duplicado do mesmo médico no mesmo mês. Sem cache
   *  (precisa refletir uma emissão feita há poucos segundos). */
  medicosComBoleto: (competencia: string) =>
    apiFetch<{ medicoIds: string[] }>(`/execucoes/medicos-com-boleto?competencia=${competencia}`),
  historicoMedico: (chave: { medicoId?: string; cpf?: string }) => {
    const qs = new URLSearchParams();
    if (chave.medicoId) qs.set('medicoId', chave.medicoId);
    else if (chave.cpf) qs.set('cpf', chave.cpf);
    return apiFetch<ExecucaoHistoricoMedicoItem[]>(`/execucoes/por-medico/historico?${qs}`);
  },
};

export const execucaoQueryKeys = {
  execucoes: () => ['execucoes'] as const,
  execucao: (id: string) => ['execucoes', id] as const,
  resultados: (id: string) => ['execucoes', id, 'resultados'] as const,
  contribuicoes: (resultadoId: string) => ['execucoes', 'resultados', resultadoId, 'contribuicoes'] as const,
  apoio: () => ['execucoes', 'apoio'] as const,
  lotes: (producaoId: string) => ['execucoes', 'lotes', producaoId] as const,
  medicosComBoleto: (competencia: string) => ['execucoes', 'medicos-com-boleto', competencia] as const,
  resumoPorMedico: () => ['execucoes', 'por-medico'] as const,
  historicoMedico: (chave: string) => ['execucoes', 'por-medico', 'historico', chave] as const,
};
