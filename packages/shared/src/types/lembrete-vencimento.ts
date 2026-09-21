// Lembrete automático de vencimento de boleto (D-1) — Épico 13, Fase 1.

/** Config do lembrete automático de vencimento (tabela config_lembrete_vencimento, singleton).
 *  Sem lista de destinatários: o destinatário é sempre o próprio pagador do boleto. */
export interface ConfigLembreteVencimento {
  habilitado: boolean;
}
