import type { LoteEmissao, LoteEmissaoItem, ContaEmissora } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

/** Item do lote enriquecido com o nome do pagador — só para exibição (ver rota /boletos/lotes). */
export interface LoteEmissaoItemComNome extends LoteEmissaoItem {
  nome: string;
}

export interface PreviewLoteEmissao {
  lote: LoteEmissao;
  itens: LoteEmissaoItemComNome[];
  porContaEmissora: { contaEmissora: ContaEmissora; itens: number; valor: number }[];
}

export const lotesEmissaoService = {
  /** Fase A — cria o preview (síncrono, só leitura, sem efeito externo). */
  criarPreview: (execucaoId: string) =>
    apiFetch<PreviewLoteEmissao>('/boletos/lotes', {
      method: 'POST',
      body: JSON.stringify({ execucaoId }),
    }),
  /** Fase B — confirma o lote (revalida o snapshot no servidor); dispara o processamento. */
  confirmar: (loteId: string, snapshot: { totalItens: number; totalValor: number }) =>
    apiFetch<{ lote: LoteEmissao }>(`/boletos/lotes/${loteId}/confirmar`, {
      method: 'POST',
      body: JSON.stringify(snapshot),
    }),
  /** Retoma um lote pausado pelo circuit breaker. */
  retomar: (loteId: string) =>
    apiFetch<{ lote: LoteEmissao }>(`/boletos/lotes/${loteId}/retomar`, { method: 'POST' }),
  /** Acompanhamento (polling) — status e itens atuais. */
  status: (loteId: string) =>
    apiFetch<{ lote: LoteEmissao; itens: LoteEmissaoItem[] }>(`/boletos/lotes/${loteId}`),
};
