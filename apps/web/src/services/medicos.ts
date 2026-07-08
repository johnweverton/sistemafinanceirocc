import type { Medico, MedicoHistorico, DadosCobranca, CondicoesCobranca, ClienteExterno } from '@cobranca/shared';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { ApiErrorBody } from '@/lib/api-error';

export interface ImportarResultado {
  criados: number;
  erros: { linha: number; cpf: string; erro: string }[];
}

export interface SyncCandidata {
  medicoId: string;
  nome: string;
  score: number;
  viaCpf: boolean;
}
export interface SyncPendenciaSugestao {
  cliente: ClienteExterno;
  candidatas: SyncCandidata[];
}
export interface CriarTodosResultado {
  criados: number;
  ignorados: { externalId: string; nome: string | null; motivo: string }[];
}
export interface ExclusaoLoteResultado {
  excluidos: number;
  bloqueados: { id: string; nome: string; motivo: string }[];
}
export interface SyncRelatorio {
  totalOrigem: number;
  jaVinculados: number;
  atualizados: number;
  comSugestao: SyncPendenciaSugestao[];
  semPar: ClienteExterno[];
  naoSincronizaveis: { cliente: ClienteExterno; motivo: string }[];
}

export interface NovoMedicoPayload {
  cpf: string;
  nome: string;
  especialidade: string | null;
  statusHapvida: Medico['statusHapvida'];
  fazOutrosHospitais: boolean;
  fazImobilizacoes: boolean;
  modoMudancaData: Medico['modoMudancaData'];
  // Modo de cobrança (Story 6.2) — percentual obrigatório quando modo = percentual_producao.
  modoCobranca: Medico['modoCobranca'];
  percentualProducao: number | null;
  colaboradorResponsavel: string | null;
  ativo: boolean;
  // Cobrança (Fase 3) — opcional; médico pode ser salvo e completado depois.
  cobranca?: DadosCobranca | null;
  condicoes?: CondicoesCobranca | null;
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
  sincronizar: () => apiFetch<SyncRelatorio>('/sync/medicos', { method: 'POST' }),
  vincularExterno: (payload: { medicoId: string; externalId: string }) =>
    apiFetch<Medico>('/sync/medicos/vincular', { method: 'POST', body: JSON.stringify(payload) }),
  criarExterno: (payload: { externalId: string }) =>
    apiFetch<Medico>('/sync/medicos/criar', { method: 'POST', body: JSON.stringify(payload) }),
  criarTodosExternos: (payload: { externalIds: string[] }) =>
    apiFetch<CriarTodosResultado>('/sync/medicos/criar-todos', { method: 'POST', body: JSON.stringify(payload) }),
  excluir: (id: string) => apiFetch<void>(`/medicos/${id}`, { method: 'DELETE' }),
  excluirLote: (ids: string[]) =>
    apiFetch<ExclusaoLoteResultado>('/medicos/excluir-lote', { method: 'POST', body: JSON.stringify({ ids }) }),
};

export const queryKeys = {
  medicos: () => ['medicos'] as const,
  medico: (id: string) => ['medicos', id] as const,
  medicoHistorico: (id: string) => ['medicos', id, 'historico'] as const,
};
