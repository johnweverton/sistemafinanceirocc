// Service do plano de contas + regras de categorização (Story 9.3) — chamadas às rotas
// internas da 9.2. Escrita é admin-only no backend; o service não filtra por papel (a
// UI confia no 403 do servidor, mesmo padrão de config-cobranca).
import type {
  PlanoContas,
  GrupoPlanoContas,
  RegraCategorizacao,
  CampoRegraCategorizacao,
} from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export interface CriarCategoriaInput {
  grupo: GrupoPlanoContas;
  nome: string;
  ordem?: number;
}

export interface AtualizarCategoriaInput {
  nome?: string;
  ordem?: number;
}

export interface CriarRegraInput {
  categoriaId: string;
  campo: CampoRegraCategorizacao;
  padrao: string;
  prioridade?: number;
}

export interface AtualizarRegraInput {
  campo?: CampoRegraCategorizacao;
  padrao?: string;
  prioridade?: number;
}

export const planoContasService = {
  listarCategorias: (ativo?: boolean) => {
    const qs = ativo === undefined ? '' : `?ativo=${ativo}`;
    return apiFetch<PlanoContas[]>(`/plano-contas${qs}`);
  },
  criarCategoria: (input: CriarCategoriaInput) =>
    apiFetch<PlanoContas>('/plano-contas', { method: 'POST', body: JSON.stringify(input) }),
  atualizarCategoria: (id: string, input: AtualizarCategoriaInput) =>
    apiFetch<PlanoContas>(`/plano-contas/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  desativarCategoria: (id: string) =>
    apiFetch<PlanoContas>(`/plano-contas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ativo: false }),
    }),
  excluirCategoria: (id: string) => apiFetch<void>(`/plano-contas/${id}`, { method: 'DELETE' }),

  listarRegras: (ativo?: boolean) => {
    const qs = ativo === undefined ? '' : `?ativo=${ativo}`;
    return apiFetch<RegraCategorizacao[]>(`/plano-contas/regras${qs}`);
  },
  criarRegra: (input: CriarRegraInput) =>
    apiFetch<RegraCategorizacao>('/plano-contas/regras', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  atualizarRegra: (id: string, input: AtualizarRegraInput) =>
    apiFetch<RegraCategorizacao>(`/plano-contas/regras/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  desativarRegra: (id: string) =>
    apiFetch<RegraCategorizacao>(`/plano-contas/regras/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ativo: false }),
    }),
  excluirRegra: (id: string) =>
    apiFetch<void>(`/plano-contas/regras/${id}`, { method: 'DELETE' }),
};

export const planoContasQueryKeys = {
  categorias: (ativo?: boolean) => ['plano-contas', 'categorias', ativo] as const,
  regras: (ativo?: boolean) => ['plano-contas', 'regras', ativo] as const,
};
