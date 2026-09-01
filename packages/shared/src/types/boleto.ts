// Boleto — registro de emissão de cobrança via gateway (Fase 3, PRD §10).
// FEATURE DESLIGADA POR PADRÃO: nunca emite sem confirmação humana explícita, por médico,
// um boleto por vez, e só sobre resultado com status 'ok' (PRD §2 / §10).

import type { ContaEmissora } from './conta-emissora';
import type { ModoVencimento } from './medico';

export type GatewayBoleto = 'cora' | 'mock';

/** Tipo do disparo (migration 0056): emissão do boleto, lembrete preventivo de vencimento (D-1,
 *  Épico 13 Fase 1) ou cobrança de reforço pós-vencimento (Fase 2 — reservado, não emitido ainda). */
export type TipoDisparoBoleto = 'emissao' | 'lembrete_vencimento' | 'cobranca_vencido';

/** Registro de envio do boleto por canal (WhatsApp/e-mail) — auditoria de disparo. */
export interface DisparoBoleto {
  canal: 'whatsapp' | 'email';
  status: 'sucesso' | 'falha';
  mensagemErro: string | null;
  enviadoEm: string;
  tipo: TipoDisparoBoleto;
}
// 'pago'/'cancelado' são resultado da baixa via webhook (Épico 4). 'vencido' NÃO é armazenado —
// é derivado on-read (vencimento < hoje e sem baixa). 'processando' (migration 0037) é a
// RESERVA gravada antes de chamar o gateway — existe só entre o INSERT e o UPDATE da emissão
// (Achados 1/2 da revisão de arquitetura do lote); nunca deveria ficar visível por muito tempo.
export type StatusBoleto = 'processando' | 'emitido' | 'falha' | 'pago' | 'cancelado';

export interface Boleto {
  id: string;
  execucaoResultadoId: string;
  gateway: GatewayBoleto;
  /** Conta Cora que emitiu ESTE boleto (Épico 7) — operações pós-emissão usam sempre esta. */
  contaEmissora: ContaEmissora;
  idExterno: string | null; // id retornado pelo gateway (ex.: invoice id da Cora)
  status: StatusBoleto;
  emitidoPor: string; // profiles.id de quem confirmou a emissão
  emitidoEm: string;
  payloadResposta: unknown; // resposta crua do gateway, para auditoria
  // Baixa / conciliação (Épico 4) — nullable até o pagamento.
  vencimento: string | null; // data de vencimento (AAAA-MM-DD) enviada ao Cora
  pagoEm: string | null; // timestamp da baixa
  valorPago: number | null; // valor efetivamente pago
  // Cancelamento ativo (Story 6.1) — nullable; preenchidos só quando cancelado PELO sistema
  // (baixa 'cancelado' via webhook não preenche — origem externa).
  canceladoEm: string | null;
  canceladoPor: string | null; // profiles.id de quem cancelou
  motivoCancelamento: string | null;
  /** Lote de emissão que gerou este boleto (migration 0038); null = emissão manual/individual. */
  loteId: string | null;
}

/** Evento de webhook do Cora — auditoria + idempotência (Épico 4). */
export interface BoletoEvento {
  id: string;
  boletoId: string | null; // null se o evento não casou com um boleto (órfão)
  idExterno: string | null; // invoice id recebido no evento
  eventoId: string | null; // id/idempotency-key do evento (dedupe)
  eventoTipo: string | null; // ex.: 'invoice.paid', 'invoice.canceled'
  statusReconsultado: string | null; // status confirmado via reconsulta na API Cora
  payload: unknown; // corpo cru do webhook
  recebidoEm: string;
}

/** Condições comerciais efetivas (após resolver override do médico ?? default global). */
export interface CondicoesEmissao {
  diasVencimento: number;
  multaPercent: number | null;
  jurosMesPercent: number | null;
  descontoPercent: number | null;
  descontoDias: number | null;
  /** 'dia_fixo' (Epic 11) usa `diaFixoVencimento` em vez de `diasVencimento` — ver `calcularVencimento`. */
  modoVencimento: ModoVencimento;
  diaFixoVencimento: number | null;
}

/** Defaults globais do escritório (tabela config_cobranca, singleton). */
export interface ConfigCobranca {
  diasVencimento: number;
  multaPercent: number | null;
  jurosMesPercent: number | null;
  descontoPercent: number | null;
  descontoDias: number | null;
  /** Valor unitário da consulta ambulatorial de pediatria (Story 10.2), ex.: 3.00 = R$3,00. */
  valorConsultaPediatria: number;
}

/**
 * Dados necessários para emitir um boleto — montado pela rota a partir do resultado + médico.
 * O pagador vem do bloco de cobrança do médico (não do CPF do resultado, que é só a chave
 * de cruzamento com a API da Carmem). As condições já vêm resolvidas (override ?? global).
 */
export interface DadosEmissaoBoleto {
  execucaoResultadoId: string;
  competencia: string;
  valor: number;
  /** Nº de guias cobradas neste resultado — entra na descrição do boleto (item `services`
   *  da Cora). Null/undefined (ex.: cliente contábil, sem produção de guias) omite o trecho. */
  quantidadeGuias?: number | null;
  pagador: {
    nome: string;
    documento: string; // CPF (11) ou CNPJ (14), dígitos
    tipo: 'CPF' | 'CNPJ';
    // E-mail e endereço são opcionais — a Cora não exige pra emitir boleto registrado
    // (Épico 6). Endereço é tudo-ou-nada: se enviado, precisa vir com todos os subcampos.
    email?: string | null;
    endereco?: {
      cep: string;
      logradouro: string;
      numero: string;
      complemento: string | null;
      bairro: string;
      cidade: string;
      uf: string;
    } | null;
  };
  condicoes: CondicoesEmissao;
}

/** Resultado da emissão devolvido por um BoletoGateway (antes de persistir). */
export interface EmissaoBoleto {
  idExterno: string;
  status: StatusBoleto;
  payloadResposta: unknown;
}

/**
 * Status real de uma invoice consultado no gateway (fonte da verdade para a baixa via webhook).
 * `unknown` = não foi possível determinar (erro/404) — o chamador não deve dar baixa.
 */
export interface StatusInvoice {
  status: 'paid' | 'canceled' | 'open' | 'overdue' | 'unknown';
  valorPago: number | null;
  pagoEm: string | null;
}

/**
 * Resultado do cancelamento de uma invoice no gateway (Story 6.1). `sucesso=false` carrega o
 * payload cru do erro para auditoria — o gateway NUNCA lança exceção não tratada.
 */
export interface ResultadoCancelamento {
  sucesso: boolean;
  payloadResposta: unknown;
}

/**
 * Porta/adapter — qualquer gateway de boleto implementa esta interface.
 * Trocar de provedor (Cora → outro) não exige redesenho: basta criar
 * uma nova implementação e registrar na factory.
 */
export interface BoletoGatewayPort {
  /**
   * `idempotencyKey` é OBRIGATÓRIA e deve ser o id do registro `boletos` já reservado
   * (status 'processando') ANTES desta chamada — nunca gerada aqui dentro (migration 0037,
   * Achado 2 da revisão de arquitetura: uma chave por TENTATIVA, não por registro persistido,
   * deixava reprocessamento gerar um segundo boleto real).
   */
  emitir(dados: DadosEmissaoBoleto, idempotencyKey: string): Promise<EmissaoBoleto>;
  /** Consulta o status real da invoice no gateway (usado na conciliação do webhook). */
  consultarInvoice(idExterno: string): Promise<StatusInvoice>;
  /** Cancela uma invoice em aberto no gateway (Story 6.1 — cancelamento ativo). */
  cancelar(idExterno: string): Promise<ResultadoCancelamento>;
}
