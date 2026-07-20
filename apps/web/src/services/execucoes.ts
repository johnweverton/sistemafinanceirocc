import type {
  Execucao,
  ExecucaoResultado,
  ExecucaoResumoMedico,
  ExecucaoHistoricoMedicoItem,
  Medico,
} from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export interface ExecucaoSelecaoPayload {
  medicoId: string;
  producaoExternaId: string;
  producaoNome: string;
  /** Produção de consultas de pediatria (Story 10.2) — opcional. */
  producaoConsultasExternaId?: string | null;
  producaoConsultasNome?: string | null;
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
  disparar: (competencia: string, selecoes: ExecucaoSelecaoPayload[]) =>
    apiFetch<{ execucaoId: string }>('/execucoes', {
      method: 'POST',
      body: JSON.stringify({ competencia, selecoes }),
    }),
  listar: () => apiFetch<Execucao[]>('/execucoes'),
  detalhe: (id: string) => apiFetch<Execucao>(`/execucoes/${id}`),
  resultados: (id: string) => apiFetch<ExecucaoResultado[]>(`/execucoes/${id}/resultados`),
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
  apoio: () => ['execucoes', 'apoio'] as const,
  resumoPorMedico: () => ['execucoes', 'por-medico'] as const,
  historicoMedico: (chave: string) => ['execucoes', 'por-medico', 'historico', chave] as const,
};
