import type {
  ClienteContabilidade,
  ClienteContabilidadeHistorico,
  ClienteContabilidadeFaturamento,
  ExecucaoHistoricoMedicoItem,
  DadosCobranca,
  CondicoesCobranca,
  RegraPreco,
  ContaEmissora,
  RegimeTributario,
  ModoCobrancaContabilidade,
} from '@cobranca/shared';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { ApiErrorBody } from '@/lib/api-error';
import type { ImportarResultado } from './shared/importar';

export type { ImportarResultado };

export interface LancarFaturamentoPayload {
  competencia: string;
  faturamento: number;
}

export interface LancarFaturamentoResposta {
  faturamento: ClienteContabilidadeFaturamento;
  preview: { valor: number; alertas: string[]; subtotalFaixa: string };
}

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

export interface ExclusaoLoteResultado {
  excluidos: number;
  bloqueados: { id: string; nome: string; motivo: string }[];
}

// Cálculo/emissão em lote (feedback do dono, 2026-08-20) — sem emissão em lote própria: o
// cálculo devolve um `execucaoId` que o mecanismo JÁ EXISTENTE de emissão em lote de boletos
// (LoteEmissaoDialog) consome sem mudança nenhuma (já é agnóstico de médico/empresa/cliente).
export interface DispararLotePayload {
  competencia: string;
  clienteContabilidadeIds: string[];
}

export interface LancamentoFaturamentoLotePayload {
  clienteContabilidadeId: string;
  faturamento: number;
}

export interface ResultadoLancamentoFaturamentoLote {
  lancados: number;
  falhas: { clienteContabilidadeId: string; motivo: string }[];
}

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
  excluirLote: (ids: string[]) =>
    apiFetch<ExclusaoLoteResultado>('/clientes-contabilidade/excluir-lote', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  importar: async (arquivo: File): Promise<ImportarResultado> => {
    const form = new FormData();
    form.append('arquivo', arquivo);
    const res = await fetch('/api/clientes-contabilidade/importar', { method: 'POST', body: form });
    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try { body = (await res.json()) as ApiErrorBody; } catch { /* non-JSON */ }
      throw new ApiClientError(res.status, body?.error?.message ?? `Erro ${res.status}`, body?.error?.code ?? 'ERROR');
    }
    return res.json() as Promise<ImportarResultado>;
  },
  listarFaturamentos: (id: string) =>
    apiFetch<ClienteContabilidadeFaturamento[]>(`/clientes-contabilidade/${id}/faturamentos`),
  execucoes: (id: string) =>
    apiFetch<ExecucaoHistoricoMedicoItem[]>(`/clientes-contabilidade/${id}/execucoes`),
  lancarFaturamento: (id: string, payload: LancarFaturamentoPayload) =>
    apiFetch<LancarFaturamentoResposta>(`/clientes-contabilidade/${id}/faturamentos`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  lancarFaturamentoLote: (competencia: string, lancamentos: LancamentoFaturamentoLotePayload[]) =>
    apiFetch<ResultadoLancamentoFaturamentoLote>('/clientes-contabilidade/faturamentos/lote', {
      method: 'POST',
      body: JSON.stringify({ competencia, lancamentos }),
    }),
  dispararLote: (payload: DispararLotePayload) =>
    apiFetch<{ execucaoId: string }>('/clientes-contabilidade/lote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  // Story 12.3 (RS-1): quem já tem boleto ativo (emitido/pago) na competência, em qualquer
  // execução. O diálogo de lote usa isso pra remover esses clientes do payload ANTES de calcular.
  // A rota não cacheia de propósito — precisa refletir emissão feita há segundos.
  comBoleto: (competencia: string) =>
    apiFetch<{ clienteContabilidadeIds: string[] }>(
      `/clientes-contabilidade/com-boleto?competencia=${encodeURIComponent(competencia)}`,
    ),
};

export const clienteContabilidadeQueryKeys = {
  clientes: () => ['clientes-contabilidade'] as const,
  cliente: (id: string) => ['clientes-contabilidade', id] as const,
  clienteHistorico: (id: string) => ['clientes-contabilidade', id, 'historico'] as const,
  clienteFaturamentos: (id: string) => ['clientes-contabilidade', id, 'faturamentos'] as const,
  clienteExecucoes: (id: string) => ['clientes-contabilidade', id, 'execucoes'] as const,
  /** Chaveada por competência: trocar a competência refaz a consulta (a lista muda com ela). */
  comBoleto: (competencia: string) => ['clientes-contabilidade', 'com-boleto', competencia] as const,
};
