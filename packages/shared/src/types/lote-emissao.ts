// Emissão de boletos em lote (revisão de arquitetura 2026-07-31, decisão 5). Ver comentário de
// cabeçalho da migration 0038 para o fluxo completo (preview → confirmar → processar).

import type { ContaEmissora } from './conta-emissora';

/** Só 'execucao' está implementado hoje — 'competencia' fica reservado para extensão futura. */
export type EscopoLoteEmissao = 'execucao' | 'competencia';

export type StatusLoteEmissao =
  | 'aguardando_confirmacao'
  | 'processando'
  | 'pausado_por_falhas'
  | 'concluido'
  | 'cancelado'
  | 'expirado';

export type StatusItemLoteEmissao = 'pendente' | 'emitido' | 'pulado' | 'falha';

export interface LoteEmissao {
  id: string;
  escopoTipo: EscopoLoteEmissao;
  escopoRef: string;
  status: StatusLoteEmissao;
  criadoPor: string;
  criadoEm: string;
  confirmadoPor: string | null;
  confirmadoEm: string | null;
  finalizadoEm: string | null;
  snapshotTotalItens: number;
  snapshotTotalValor: number;
  progresso: number;
  falhasConsecutivas: number;
  motivoPausa: string | null;
  totalEmitidos: number;
  totalPulados: number;
  totalFalhas: number;
  totalValorEmitido: number;
}

export interface LoteEmissaoItem {
  id: string;
  loteId: string;
  execucaoResultadoId: string;
  contaEmissora: ContaEmissora | null;
  valorSnapshot: number;
  status: StatusItemLoteEmissao;
  codigoErro: string | null;
  mensagemErro: string | null;
  boletoId: string | null;
  processadoEm: string | null;
}
