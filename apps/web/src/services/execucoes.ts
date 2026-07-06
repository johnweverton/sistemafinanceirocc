import type { Execucao, ExecucaoResultado, Medico } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export interface ExecucaoSelecaoPayload {
  medicoId: string;
  producaoExternaId: string;
  producaoNome: string;
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
};

export const execucaoQueryKeys = {
  execucoes: () => ['execucoes'] as const,
  execucao: (id: string) => ['execucoes', id] as const,
  resultados: (id: string) => ['execucoes', id, 'resultados'] as const,
  apoio: () => ['execucoes', 'apoio'] as const,
};
