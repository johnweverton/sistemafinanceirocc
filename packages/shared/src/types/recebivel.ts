// Recebível — linha de Contas a Receber (Épico 4, Story 4.4). Deriva da view vw_recebiveis.
import type { DisparoBoleto } from './boleto';
import type { ContaEmissora } from './conta-emissora';
import type { TipoServico } from './tipo-servico';

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
  /** Cliente contábil de origem, quando `tipoServico === 'contabilidade'` (migration 0050). */
  clienteContabilidadeId: string | null;
  /** Cobrança médica vs contabilidade (migration 0050) — derivado de clienteContabilidadeId,
   *  NUNCA de contaEmissora (as 4 contas atendem qualquer tipo de serviço desde a 0040). */
  tipoServico: TipoServico;
  /** Disparos de notificação (WhatsApp/e-mail) do boleto — badges de status na UI. */
  disparos?: DisparoBoleto[];
}

export interface FiltroRecebiveis {
  competencia?: string;
  medicoId?: string;
  statusDerivado?: StatusRecebivel;
  /** Filtro por empresa emissora (Story 7.3). */
  contaEmissora?: ContaEmissora;
  /** Filtro por tipo de serviço — cobrança médica vs contabilidade (migration 0050). */
  tipoServico?: TipoServico;
}
