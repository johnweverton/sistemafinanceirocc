// Boleto — registro de emissão de cobrança via gateway (Fase 3, PRD §10).
// FEATURE DESLIGADA POR PADRÃO: nunca emite sem confirmação humana explícita, por médico,
// um boleto por vez, e só sobre resultado com status 'ok' (PRD §2 / §10).

export type GatewayBoleto = 'cora' | 'mock';
// 'pago'/'cancelado' são resultado da baixa via webhook (Épico 4). 'vencido' NÃO é armazenado —
// é derivado on-read (vencimento < hoje e sem baixa).
export type StatusBoleto = 'emitido' | 'falha' | 'pago' | 'cancelado';

export interface Boleto {
  id: string;
  execucaoResultadoId: string;
  gateway: GatewayBoleto;
  idExterno: string | null; // id retornado pelo gateway (ex.: invoice id da Cora)
  status: StatusBoleto;
  emitidoPor: string; // profiles.id de quem confirmou a emissão
  emitidoEm: string;
  payloadResposta: unknown; // resposta crua do gateway, para auditoria
  // Baixa / conciliação (Épico 4) — nullable até o pagamento.
  vencimento: string | null; // data de vencimento (AAAA-MM-DD) enviada ao Cora
  pagoEm: string | null; // timestamp da baixa
  valorPago: number | null; // valor efetivamente pago
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
}

/** Defaults globais do escritório (tabela config_cobranca, singleton). */
export interface ConfigCobranca {
  diasVencimento: number;
  multaPercent: number | null;
  jurosMesPercent: number | null;
  descontoPercent: number | null;
  descontoDias: number | null;
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
  pagador: {
    nome: string;
    documento: string; // CPF (11) ou CNPJ (14), dígitos
    tipo: 'CPF' | 'CNPJ';
    email: string;
    endereco: {
      cep: string;
      logradouro: string;
      numero: string;
      complemento: string | null;
      bairro: string;
      cidade: string;
      uf: string;
    };
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
 * Porta/adapter — qualquer gateway de boleto implementa esta interface.
 * Trocar de provedor (Cora → outro) não exige redesenho: basta criar
 * uma nova implementação e registrar na factory.
 */
export interface BoletoGatewayPort {
  emitir(dados: DadosEmissaoBoleto): Promise<EmissaoBoleto>;
  /** Consulta o status real da invoice no gateway (usado na conciliação do webhook). */
  consultarInvoice(idExterno: string): Promise<StatusInvoice>;
}
