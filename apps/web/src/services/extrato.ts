import type {
  ContaEmissora,
  ExtratoTransacaoComBoleto,
  Recebivel,
  StatusConciliacao,
  TipoTransacaoExtrato,
  TotaisExtrato,
} from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

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
};

export const extratoQueryKeys = {
  extrato: (filtros: FiltroExtratoUi) => ['extrato', filtros] as const,
  boletosConciliaveis: (conta: ContaEmissora) => ['extrato', 'boletos-conciliaveis', conta] as const,
};
