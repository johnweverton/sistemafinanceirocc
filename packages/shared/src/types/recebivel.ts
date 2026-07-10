// Recebível — linha de Contas a Receber (Épico 4, Story 4.4). Deriva da view vw_recebiveis.
import type { DisparoBoleto } from './boleto';
import type { ContaEmissora } from './conta-emissora';

export type StatusRecebivel = 'pago' | 'cancelado' | 'vencido' | 'em_aberto';

export interface Recebivel {
  boletoId: string;
  execucaoResultadoId: string;
  idExterno: string | null;
  competencia: string;
  medicoId: string | null;
  nome: string;
  valor: number | null;
  vencimento: string | null;
  pagoEm: string | null;
  valorPago: number | null;
  emitidoEm: string;
  /** Conta Cora que emitiu o boleto (Épico 7) — badge/filtro "Empresa" na UI. */
  contaEmissora: ContaEmissora;
  statusDerivado: StatusRecebivel;
  /** Disparos de notificação (WhatsApp/e-mail) do boleto — badges de status na UI. */
  disparos?: DisparoBoleto[];
}

export interface FiltroRecebiveis {
  competencia?: string;
  medicoId?: string;
  statusDerivado?: StatusRecebivel;
}
