// Tipos de transporte do contrato REAL da API do Sistema Web (Épico 5, arquitetura §3.2).
// Espelham docs/integracao/api-financeiro-sistema-web.md — NÃO persistidos, vivem só em
// memória durante sincronização/execução (mesmo papel que Procedimento tinha no contrato antigo).

/** Médico na origem (GET /api/fin-clientes). A origem NÃO expõe especialidade. */
export interface ClienteExterno {
  id: string; // UUID na origem — vira medicos.external_id no vínculo
  nome: string; // name
  cpf: string | null; // cpf: só dígitos — dado cadastral/conferência, não usado para criação automática
  productionType: string; // production_type: "Produção Credenciada" | "Produção VH" (cru)
}

/** Produção nomeada de um médico (GET /api/fin-producoes?clienteId=). Ex.: "Janeiro 2026". */
export interface ProducaoExterna {
  id: string; // UUID na origem
  nome: string; // name
}

/**
 * Sub-lote dentro de uma produção mensal (GET /api/fin-lotes?producaoId=<id da produção
 * mensal>). Usado pelo médico Angiologista, que não tem produção própria por tipo — Cateter/
 * Fístula/Angiografia/Carta de Rede são sub-grupos aninhados dentro da produção do mês no painel
 * de origem (devolutiva do desenvolvedor, GATE 2026-08-13). Id de lote NÃO é um id de produção —
 * itens de um lote só são consultáveis via `GET /api/fin-itens?loteId=`, nunca `producaoId=`.
 */
export interface LoteExterna {
  id: string; // id do sub-lote na origem
  nome: string; // name — texto livre, digitado manualmente (sem grafia garantida entre competências)
}

/**
 * Item (procedimento) de uma produção (GET /api/fin-itens?producaoId=).
 * `statusOrigem` é informativo — NUNCA filtra contagem (Épico 5, decisão 5).
 * `valorCobradoOrigem`/`valorPagoOrigem`: informativos no modo faixas (decisão 8 do Épico 5).
 * REVISÃO ESCOPADA (Story 6.2): no modo `percentual_producao`, `valorCobradoOrigem` é a BASE
 * de cálculo (percentual × Σ valor cobrado, glosados incluídos — GATE do dono 2026-07-08).
 * No modo faixas, nada muda.
 */
export interface ItemProducao {
  data: string; // YYYY-MM-DD (date)
  pacienteNome: string; // patient_name
  /**
   * Senha da guia/autorização (campo `password` na origem, entregue em 2026-07-07).
   * Chave de agrupamento com fallback (paciente, data) — arquitetura §3.3/§10.3.
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
