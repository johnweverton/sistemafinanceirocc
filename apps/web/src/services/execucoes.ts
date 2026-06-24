import type { Execucao, ExecucaoResultado } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export const execucoesService = {
  disparar: (competencia: string) =>
    apiFetch<{ execucaoId: string }>('/execucoes', {
      method: 'POST',
      body: JSON.stringify({ competencia }),
    }),
  listar: () => apiFetch<Execucao[]>('/execucoes'),
  detalhe: (id: string) => apiFetch<Execucao>(`/execucoes/${id}`),
  resultados: (id: string) => apiFetch<ExecucaoResultado[]>(`/execucoes/${id}/resultados`),
};

export const execucaoQueryKeys = {
  execucoes: () => ['execucoes'] as const,
  execucao: (id: string) => ['execucoes', id] as const,
  resultados: (id: string) => ['execucoes', id, 'resultados'] as const,
};
