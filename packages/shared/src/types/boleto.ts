// Boleto — registro de emissão de cobrança via gateway (Fase 3, PRD §10).
// FEATURE DESLIGADA POR PADRÃO: nunca emite sem confirmação humana explícita, por médico,
// um boleto por vez, e só sobre resultado com status 'ok' (PRD §2 / §10).

export type GatewayBoleto = 'cora' | 'mock';
export type StatusBoleto = 'emitido' | 'falha';

export interface Boleto {
  id: string;
  execucaoResultadoId: string;
  gateway: GatewayBoleto;
  idExterno: string | null; // id retornado pelo gateway (ex.: invoice id da Cora)
  status: StatusBoleto;
  emitidoPor: string; // profiles.id de quem confirmou a emissão
  emitidoEm: string;
  payloadResposta: unknown; // resposta crua do gateway, para auditoria
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
 * Porta/adapter — qualquer gateway de boleto implementa esta interface.
 * Trocar de provedor (Cora → outro) não exige redesenho: basta criar
 * uma nova implementação e registrar na factory.
 */
export interface BoletoGatewayPort {
  emitir(dados: DadosEmissaoBoleto): Promise<EmissaoBoleto>;
}
