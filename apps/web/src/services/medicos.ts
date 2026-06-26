import type { Medico, MedicoHistorico } from '@cobranca/shared';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { ApiErrorBody } from '@/lib/api-error';

export interface ImportarResultado {
  criados: number;
  erros: { linha: number; cpf: string; erro: string }[];
}

export interface NovoMedicoPayload {
  cpf: string;
  nome: string;
  especialidade: string | null;
  statusHapvida: Medico['statusHapvida'];
  fazOutrosHospitais: boolean;
  fazImobilizacoes: boolean;
  modoMudancaData: Medico['modoMudancaData'];
  colaboradorResponsavel: string | null;
  ativo: boolean;
}

export type AtualizarMedicoPayload = Partial<NovoMedicoPayload> & {
  motivo: string;
  necessitaConfiguracao?: boolean;
};

export const medicosService = {
  listar: () => apiFetch<Medico[]>('/medicos'),
  detalhe: (id: string) => apiFetch<Medico>(`/medicos/${id}`),
  criar: (payload: NovoMedicoPayload) =>
    apiFetch<Medico>('/medicos', { method: 'POST', body: JSON.stringify(payload) }),
  atualizar: (id: string, payload: AtualizarMedicoPayload) =>
    apiFetch<Medico>(`/medicos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  historico: (id: string) => apiFetch<MedicoHistorico[]>(`/medicos/${id}/historico`),
  importar: async (arquivo: File): Promise<ImportarResultado> => {
    const form = new FormData();
    form.append('arquivo', arquivo);
    const res = await fetch('/api/medicos/importar', { method: 'POST', body: form });
    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try { body = (await res.json()) as ApiErrorBody; } catch { /* non-JSON */ }
      throw new ApiClientError(res.status, body?.error?.message ?? `Erro ${res.status}`, body?.error?.code ?? 'ERROR');
    }
    return res.json() as Promise<ImportarResultado>;
  },
};

export const queryKeys = {
  medicos: () => ['medicos'] as const,
  medico: (id: string) => ['medicos', id] as const,
  medicoHistorico: (id: string) => ['medicos', id, 'historico'] as const,
};
