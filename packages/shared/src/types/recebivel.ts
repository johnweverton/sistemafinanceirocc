// Recebível — linha de Contas a Receber (Épico 4, Story 4.4). Deriva da view vw_recebiveis.

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
  statusDerivado: StatusRecebivel;
}

export interface FiltroRecebiveis {
  competencia?: string;
  medicoId?: string;
  statusDerivado?: StatusRecebivel;
}
