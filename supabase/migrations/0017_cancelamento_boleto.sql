-- Migration 0017 — cancelamento ativo de boleto (Story 6.1).
-- Adiciona a trilha de auditoria do cancelamento feito PELO sistema (quem, quando, por quê).
-- A baixa 'cancelado' via webhook (Épico 4) NÃO preenche estes campos — origem externa.
--
-- Impacto nas views (verificado na story):
--   - vw_recebiveis (0008): já deriva status 'cancelado' de boletos.status — nenhuma mudança.
--   - Dashboard (0009/0010): reusa vw_recebiveis — cancelado nunca entra em em_aberto/vencido.
--
-- Idempotente: add column if not exists. Rollback comentado no rodapé.

alter table boletos
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por uuid references profiles (id),
  add column if not exists motivo_cancelamento text;

comment on column boletos.cancelado_em is
  'Timestamp do cancelamento ATIVO via sistema (Story 6.1). Null quando cancelado externamente (webhook).';
comment on column boletos.cancelado_por is
  'profiles.id de quem confirmou o cancelamento no sistema.';
comment on column boletos.motivo_cancelamento is
  'Motivo informado no cancelamento (obrigatório na rota; livre no banco para não travar baixa externa).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table boletos
--   drop column if exists cancelado_em,
--   drop column if exists cancelado_por,
--   drop column if exists motivo_cancelamento;
