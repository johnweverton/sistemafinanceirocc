// Tipos de transporte do contrato REAL da API do Sistema Web (Épico 5, arquitetura §3.2).
// Espelham docs/integracao/api-financeiro-sistema-web.md — NÃO persistidos, vivem só em
// memória durante sincronização/execução (mesmo papel que Procedimento tinha no contrato antigo).

/** Médico na origem (GET /api/fin-clientes). A origem NÃO expõe CPF nem especialidade. */
export interface ClienteExterno {
  id: string; // UUID na origem — vira medicos.external_id no vínculo
  nome: string; // name
  productionType: string; // production_type: "Produção Credenciada" | "Produção VH" (cru)
}

/** Produção nomeada de um médico (GET /api/fin-producoes?clienteId=). Ex.: "Janeiro 2026". */
export interface ProducaoExterna {
  id: string; // UUID na origem
  nome: string; // name
}

/**
 * Item (procedimento) de uma produção (GET /api/fin-itens?producaoId=).
 * `statusOrigem` é informativo — NUNCA filtra contagem (Épico 5, decisão 5).
 * `valorCobradoOrigem`/`valorPagoOrigem` são informativos — preço segue interno (decisão 8).
 */
export interface ItemProducao {
  data: string; // YYYY-MM-DD (date)
  pacienteNome: string; // patient_name
  /**
   * Senha OU nº de atendimento — campo PEDIDO ao programador da origem (2026-07-06);
   * null até a origem entregar. Chave de agrupamento com fallback (paciente, data) —
   * arquitetura §3.3/§10.3.
   */
  atendimentoExternoId: string | null;
  codigoProcedimento: string; // proc_code (TUSS)
  descricaoProcedimento: string | null; // proc_name
  statusOrigem: string; // status: "Devidamente Pago" | "Glosado" | "Recurso" | "Aguardando Fechamento"
  viaAcesso: boolean; // via_acesso === "Sim"
  tipoAto: string | null; // act_type: "Eletivo" | "Urgência" | ...
  valorCobradoOrigem: number | null; // charged_val
  valorPagoOrigem: number | null; // paid_val
}
