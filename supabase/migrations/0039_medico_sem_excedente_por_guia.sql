-- Migration 0039 — contrato sem excedente por guia (Story 10.7, Épico 10).
-- Dr. Adilson Pontes da Rocha Filho tem contrato antigo que não previa a cobrança de R$6,00
-- por guia excedente acima do teto da última faixa (HAPVIDA_CRED, 180 guias = R$950,89) — pelo
-- contrato dele, acima de 180 guias cobra o teto fixo mesmo, sem extrapolar por guia. Mesmo
-- padrão já usado por OUTROS_HOSPITAIS/IMOBILIZACOES (Story 10.3), agora configurável por
-- médico em vez de fixo na tabela — outros médicos credenciados continuam pagando o excedente
-- normalmente.
--
-- Backfill: default false — não afeta nenhum médico existente além do que for marcado
-- manualmente depois desta migration. Idempotente: add column if not exists.

alter table medicos
  add column if not exists sem_excedente_por_guia boolean not null default false;

comment on column medicos.sem_excedente_por_guia is
  'Contrato sem excedente por guia (Story 10.7): quando true, o motor capa no valor da última faixa em vez de somar o excedente por guia acima do teto. Tabela/faixas continuam as mesmas de todo médico da mesma classe — só o excedente muda. Default false.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table medicos
--   drop column if exists sem_excedente_por_guia;
