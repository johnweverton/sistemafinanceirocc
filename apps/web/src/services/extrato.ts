import type {
  ContaEmissora,
  ExtratoTransacaoComBoleto,
  Recebivel,
  StatusConciliacao,
  TipoTransacaoExtrato,
  TotaisExtrato,
} from '@cobranca/shared';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { ApiErrorBody } from '@/lib/api-error';

export interface FiltroExtratoUi {
  conta: ContaEmissora;
  inicio?: string;
  fim?: string;
  status?: StatusConciliacao;
  tipo?: TipoTransacaoExtrato;
}

export interface RespostaExtrato {
  transacoes: ExtratoTransacaoComBoleto[];
  totais: TotaisExtrato;
}

export interface ResumoSincronizacao {
  conta: ContaEmissora;
  periodo: { inicio: string; fim: string };
  transacoes: { novas: number; atualizadas: number };
  conciliacao: {
    autoConciliadas: number;
    sugeridas: number;
    semMatch: number;
    transicoesAplicadas: number;
    transicoesDescartadas: number;
  };
}

export const extratoService = {
  listar: (filtros: FiltroExtratoUi) => {
    const qs = new URLSearchParams({ conta: filtros.conta });
    if (filtros.inicio) qs.set('inicio', filtros.inicio);
    if (filtros.fim) qs.set('fim', filtros.fim);
    if (filtros.status) qs.set('status', filtros.status);
    if (filtros.tipo) qs.set('tipo', filtros.tipo);
    return apiFetch<RespostaExtrato>(`/extrato?${qs.toString()}`);
  },
  sincronizar: (conta: ContaEmissora) =>
    apiFetch<ResumoSincronizacao>('/extrato/sincronizar', {
      method: 'POST',
      body: JSON.stringify({ conta }),
    }),
  conciliar: (transacaoId: string, boletoId: string) =>
    apiFetch<{ transacao: ExtratoTransacaoComBoleto }>(`/extrato/${transacaoId}/conciliar`, {
      method: 'POST',
      body: JSON.stringify({ boletoId }),
    }),
  ignorar: (transacaoId: string) =>
    apiFetch<{ transacao: ExtratoTransacaoComBoleto }>(`/extrato/${transacaoId}/ignorar`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  desfazer: (transacaoId: string) =>
    apiFetch<{ transacao: ExtratoTransacaoComBoleto }>(`/extrato/${transacaoId}/desfazer`, {
      method: 'POST',
    }),
  /** Sem categoriaId = roda o motor de categorização (D3) para essa transação isolada. */
  categorizar: (transacaoId: string, categoriaId?: string) =>
    apiFetch<{ transacao: ExtratoTransacaoComBoleto }>(`/extrato/${transacaoId}/categorizar`, {
      method: 'POST',
      body: JSON.stringify(categoriaId ? { categoriaId } : {}),
    }),
  boletosConciliaveis: (conta: ContaEmissora) =>
    apiFetch<Recebivel[]>(`/extrato/boletos-conciliaveis?conta=${conta}`),
  /**
   * Exporta o extrato do período em arquivo OFX (Fase 1 da exportação financeiro→contábil —
   * ver docs/research/2026-08-06-...). Resposta é um arquivo, não JSON — não usa `apiFetch`.
   */
  exportarOfx: async (filtros: { conta: ContaEmissora; inicio: string; fim: string }): Promise<Blob> => {
    const qs = new URLSearchParams(filtros);
    const res = await fetch(`/api/extrato/exportar-ofx?${qs.toString()}`);
    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        /* corpo não-JSON */
      }
      throw new ApiClientError(
        res.status,
        body?.error?.message ?? `Erro ${res.status}`,
        body?.error?.code ?? 'ERROR',
        body?.error?.details,
      );
    }
    return res.blob();
  },
};

export const extratoQueryKeys = {
  extrato: (filtros: FiltroExtratoUi) => ['extrato', filtros] as const,
  boletosConciliaveis: (conta: ContaEmissora) => ['extrato', 'boletos-conciliaveis', conta] as const,
};
