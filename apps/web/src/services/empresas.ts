import type { Empresa, EmpresaHistorico, DadosCobranca, CondicoesCobranca, RegraPreco, ContaEmissora } from '@cobranca/shared';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { ApiErrorBody } from '@/lib/api-error';
import type { ImportarResultado } from './shared/importar';

export type { ImportarResultado };

export interface NovaEmpresaPayload {
  nome: string;
  cobranca?: DadosCobranca | null;
  contaEmissora?: ContaEmissora;
  condicoes?: CondicoesCobranca | null;
  regraPreco?: RegraPreco | null;
  ativo: boolean;
}

export type AtualizarEmpresaPayload = Partial<NovaEmpresaPayload> & { motivo: string };

export const empresasService = {
  listar: () => apiFetch<Empresa[]>('/empresas'),
  detalhe: (id: string) => apiFetch<Empresa>(`/empresas/${id}`),
  criar: (payload: NovaEmpresaPayload) =>
    apiFetch<Empresa>('/empresas', { method: 'POST', body: JSON.stringify(payload) }),
  atualizar: (id: string, payload: AtualizarEmpresaPayload) =>
    apiFetch<Empresa>(`/empresas/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  historico: (id: string) => apiFetch<EmpresaHistorico[]>(`/empresas/${id}/historico`),
  excluir: (id: string) => apiFetch<void>(`/empresas/${id}`, { method: 'DELETE' }),
  importar: async (arquivo: File): Promise<ImportarResultado> => {
    const form = new FormData();
    form.append('arquivo', arquivo);
    const res = await fetch('/api/empresas/importar', { method: 'POST', body: form });
    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try { body = (await res.json()) as ApiErrorBody; } catch { /* non-JSON */ }
      throw new ApiClientError(res.status, body?.error?.message ?? `Erro ${res.status}`, body?.error?.code ?? 'ERROR');
    }
    return res.json() as Promise<ImportarResultado>;
  },
};

export const empresaQueryKeys = {
  empresas: () => ['empresas'] as const,
  empresa: (id: string) => ['empresas', id] as const,
  empresaHistorico: (id: string) => ['empresas', id, 'historico'] as const,
};
