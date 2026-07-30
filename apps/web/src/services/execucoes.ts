import type {
  Execucao,
  ExecucaoResultado,
  ExecucaoResultadoContribuicao,
  ExecucaoResumoMedico,
  ExecucaoHistoricoMedicoItem,
  Medico,
} from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export interface ExecucaoSelecaoPayload {
  medicoId: string;
  producaoExternaId: string;
  producaoNome: string;
  /** Produção de consultas de pediatria — opcional. */
  producaoConsultasExternaId?: string | null;
  producaoConsultasNome?: string | null;
  /** Lotes separados de Outros Hospitais/Imobilizações — opcionais. */
  producaoOutrosHospitaisExternaId?: string | null;
  producaoOutrosHospitaisNome?: string | null;
  producaoImobilizacoesExternaId?: string | null;
  producaoImobilizacoesNome?: string | null;
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
  resumoPorMedico: () => apiFetch<ExecucaoResumoMedico[]>('/execucoes/por-medico'),
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
  resumoPorMedico: () => ['execucoes', 'por-medico'] as const,
  historicoMedico: (chave: string) => ['execucoes', 'por-medico', 'historico', chave] as const,
};
