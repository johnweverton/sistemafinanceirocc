import type { Medico, MedicoHistorico } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

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

export type AtualizarMedicoPayload = Partial<NovoMedicoPayload> & { motivo: string };

export const medicosService = {
  listar: () => apiFetch<Medico[]>('/medicos'),
  detalhe: (id: string) => apiFetch<Medico>(`/medicos/${id}`),
  criar: (payload: NovoMedicoPayload) =>
    apiFetch<Medico>('/medicos', { method: 'POST', body: JSON.stringify(payload) }),
  atualizar: (id: string, payload: AtualizarMedicoPayload) =>
    apiFetch<Medico>(`/medicos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  historico: (id: string) => apiFetch<MedicoHistorico[]>(`/medicos/${id}/historico`),
};

export const queryKeys = {
  medicos: () => ['medicos'] as const,
  medico: (id: string) => ['medicos', id] as const,
  medicoHistorico: (id: string) => ['medicos', id, 'historico'] as const,
};
