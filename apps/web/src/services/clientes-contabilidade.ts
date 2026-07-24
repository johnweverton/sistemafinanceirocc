import type {
  ClienteContabilidade,
  ClienteContabilidadeHistorico,
  DadosCobranca,
  CondicoesCobranca,
  RegraPreco,
  ContaEmissora,
  RegimeTributario,
  ModoCobrancaContabilidade,
} from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export interface NovoClienteContabilidadePayload {
  nome: string;
  regimeTributario: RegimeTributario;
  modoCobranca: ModoCobrancaContabilidade;
  cobranca?: DadosCobranca | null;
  contaEmissora?: ContaEmissora;
  condicoes?: CondicoesCobranca | null;
  regraPreco?: RegraPreco | null;
  adicionalAtivo: boolean;
  adicionalValor?: number | null;
  adicionalIntervaloMeses?: number | null;
  adicionalCompetenciaBase?: string | null;
  ativo: boolean;
}

export type AtualizarClienteContabilidadePayload = Partial<NovoClienteContabilidadePayload> & {
  motivo: string;
};

export const clientesContabilidadeService = {
  listar: () => apiFetch<ClienteContabilidade[]>('/clientes-contabilidade'),
  detalhe: (id: string) => apiFetch<ClienteContabilidade>(`/clientes-contabilidade/${id}`),
  criar: (payload: NovoClienteContabilidadePayload) =>
    apiFetch<ClienteContabilidade>('/clientes-contabilidade', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  atualizar: (id: string, payload: AtualizarClienteContabilidadePayload) =>
    apiFetch<ClienteContabilidade>(`/clientes-contabilidade/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  historico: (id: string) =>
    apiFetch<ClienteContabilidadeHistorico[]>(`/clientes-contabilidade/${id}/historico`),
  excluir: (id: string) => apiFetch<void>(`/clientes-contabilidade/${id}`, { method: 'DELETE' }),
};

export const clienteContabilidadeQueryKeys = {
  clientes: () => ['clientes-contabilidade'] as const,
  cliente: (id: string) => ['clientes-contabilidade', id] as const,
  clienteHistorico: (id: string) => ['clientes-contabilidade', id, 'historico'] as const,
};
