// Extrato bancário e conciliação (Épico 8) — snapshot do extrato da Cora por conta emissora.
// Restrição central (arquitetura §1): a entrada do extrato NÃO referencia o invoice_id do
// boleto — o vínculo transação↔boleto é heurístico (matching em camadas, Story 8.2) e o
// estado da conciliação vive no NOSSO banco (D1), nunca na API.
// Valores sempre em REAIS no domínio — a Cora devolve centavos; a conversão é na borda (mapper).

import type { ContaEmissora } from './conta-emissora';
import type { Recebivel } from './recebivel';
import type { StatusCategorizacao } from './dre';

/** Sentido da transação no extrato (cru da API da Cora). */
export type TipoTransacaoExtrato = 'CREDIT' | 'DEBIT';

/**
 * Estado da conciliação de uma transação (D2 — matching conservador em camadas):
 *   - sem_match: nenhum boleto candidato (estado inicial).
 *   - sugerido: candidato encontrado mas SEM confiança para auto (revisão humana).
 *   - conciliado_auto: valor + documento da contraparte + janela ±3 dias (camada 1).
 *   - conciliado_manual: confirmado/vinculado por um operador.
 *   - ignorado: sem relação com boletos (tarifa, transferência interna...).
 * Toda transição é reversível e carrega trilha (conciliadoPor/conciliadoEm).
 */
export type StatusConciliacao =
  | 'sem_match'
  | 'sugerido'
  | 'conciliado_auto'
  | 'conciliado_manual'
  | 'ignorado';

/** Todos os status válidos — fonte única para CHECKs de UI/Zod (espelha a CHECK do banco). */
export const STATUS_CONCILIACAO_VALIDOS = [
  'sem_match',
  'sugerido',
  'conciliado_auto',
  'conciliado_manual',
  'ignorado',
] as const satisfies readonly StatusConciliacao[];

/**
 * Transação como vem do BANCO (gateway) — ainda SEM estado de conciliação.
 * É o que `consultarExtrato` devolve e o que o sync persiste via upsert.
 */
export interface TransacaoExtratoApi {
  /** Id da entrada no extrato da Cora — chave da idempotência do sync (com a conta). */
  entryId: string;
  tipo: TipoTransacaoExtrato;
  /** TRANSFER | PAYMENT | PIX | FEE — cru da API (FEE alimenta o card de tarifas da 8.3). */
  transactionType: string | null;
  /** Em REAIS (já convertido de centavos no mapper do gateway). */
  valor: number;
  descricao: string | null;
  contraparteNome: string | null;
  /** CPF/CNPJ da contraparte, só dígitos — chave da camada 1 do matching (8.2). */
  contraparteDocumento: string | null;
  /** Timestamp ISO da transação. */
  dataTransacao: string;
  /** Entrada crua da API, para auditoria (padrão do projeto). */
  payload: unknown;
}

/** Transação PERSISTIDA (extrato_transacoes) — com estado de conciliação e trilha. */
export interface ExtratoTransacao extends TransacaoExtratoApi {
  id: string;
  contaEmissora: ContaEmissora;
  statusConciliacao: StatusConciliacao;
  /** Boleto vinculado: conciliado_* = vínculo efetivo; sugerido = candidato proposto. */
  boletoId: string | null;
  /** Quem conciliou/ignorou (profiles.id); null quando a ação foi do sistema (auto). */
  conciliadoPor: string | null;
  conciliadoEm: string | null;
  sincronizadoEm: string;
  /**
   * Categoria do DRE (Épico 9) — eixo INDEPENDENTE da conciliação: uma transação pode
   * estar conciliada e sem categoria ao mesmo tempo até o motor de categorização rodar.
   */
  categoriaId: string | null;
  statusCategorizacao: StatusCategorizacao;
}

/**
 * Período consultado no banco — datas SEMPRE `YYYY-MM-DD` (formato errado devolve 500 na
 * Cora; o gateway valida ANTES de chamar).
 */
export interface FiltroExtrato {
  inicio: string;
  fim: string;
}

/** Filtros da LISTAGEM local (extrato_transacoes) — página /extrato e fila da 8.2/8.3. */
export interface FiltroListagemExtrato {
  contaEmissora?: ContaEmissora;
  /** Timestamps/datas ISO — aplicados sobre data_transacao (>= / <=). */
  dataInicio?: string;
  dataFim?: string;
  status?: StatusConciliacao;
  tipo?: TipoTransacaoExtrato;
}

/** Saldo de uma conta no banco (D5 — cards MC/CV no dashboard). Em REAIS. */
export interface SaldoConta {
  disponivel: number;
  /** Valor bloqueado, quando a API informa; null quando ausente. */
  bloqueado: number | null;
  consultadoEm: string;
}

/**
 * Resultados tipados das operações bancárias — erro NUNCA vira exceção solta
 * (padrão `consultarInvoice`): a chamada devolve `sucesso: false` com a razão.
 */
export type ResultadoExtrato =
  | { sucesso: true; transacoes: TransacaoExtratoApi[] }
  | { sucesso: false; erro: string };

export type ResultadoSaldo =
  | { sucesso: true; saldo: SaldoConta }
  | { sucesso: false; erro: string };

/**
 * Porta/adapter de LEITURA bancária por conta emissora (Épico 8) — uma instância = uma
 * conta (mesmo padrão do BoletoGatewayPort multi-conta da 7.2). Trocar de provedor não
 * exige redesenho: nova implementação + registro na factory.
 */
export interface ContaBancariaPort {
  consultarExtrato(filtros: FiltroExtrato): Promise<ResultadoExtrato>;
  consultarSaldo(): Promise<ResultadoSaldo>;
}

/**
 * Transação enriquecida para a UI (Story 8.3): quando há boleto vinculado (conciliado) ou
 * candidato (sugerido), o GET /api/extrato embute o resumo do recebível — a fila de
 * sugestões mostra transação × boleto lado a lado sem N+1 no cliente.
 */
export interface ExtratoTransacaoComBoleto extends ExtratoTransacao {
  boletoVinculado: Recebivel | null;
}

/** Totais do período retornados pelo GET /api/extrato (tarifas ⊂ débitos). */
export interface TotaisExtrato {
  creditos: number;
  debitos: number;
  tarifas: number;
}

/** Saldo de uma conta para os cards do dashboard (D5) — degradação por conta, nunca erro. */
export interface SaldoEmpresa {
  conta: ContaEmissora;
  nome: string;
  /** false = credenciais ausentes (CV pré-ativação) → card "não configurada". */
  configurada: boolean;
  saldo: SaldoConta | null;
  /** Presente quando configurada mas a consulta falhou (indisponível agora). */
  erro?: string;
}

/** Registro de uma sincronização executada (extrato_syncs) — auditoria + janela do próximo sync. */
export interface ExtratoSync {
  id: string;
  contaEmissora: ContaEmissora;
  periodoInicio: string;
  periodoFim: string;
  qtdNovas: number;
  qtdAtualizadas: number;
  executadoPor: string | null;
  executadoEm: string;
}
