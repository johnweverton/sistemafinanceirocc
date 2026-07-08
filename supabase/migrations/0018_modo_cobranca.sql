-- Migration 0018 — modo de cobrança por percentual da produção (Story 6.2, Épico 6).
-- Médicos auxiliares têm produção esporádica: a Carmem cobra percentual do valor produzido
-- no mês (hoje 5%, especificidade por médico) em vez da tabela de faixas por guias.
--
-- Decisões do GATE (dono, 2026-07-08):
--   - base = valor COBRADO da origem (charged_val), não o pago;
--   - itens glosados ENTRAM na base;
--   - percentual é configurável por médico (sem default de valor).
--
-- Backfill: default 'faixa_guias' → todos os médicos existentes mantêm o comportamento atual.
-- Idempotente: add column if not exists + constraints com nome fixo. Rollback no rodapé.

alter table medicos
  add column if not exists modo_cobranca text not null default 'faixa_guias',
  add column if not exists percentual_producao numeric(5,2);

-- CHECKs nomeadas (drop+add para idempotência em re-execução).
alter table medicos drop constraint if exists chk_medicos_modo_cobranca;
alter table medicos add constraint chk_medicos_modo_cobranca
  check (modo_cobranca in ('faixa_guias', 'percentual_producao'));

alter table medicos drop constraint if exists chk_medicos_percentual_producao;
alter table medicos add constraint chk_medicos_percentual_producao
  check (
    modo_cobranca <> 'percentual_producao'
    or (percentual_producao is not null and percentual_producao > 0)
  );

comment on column medicos.modo_cobranca is
  'Modo de cálculo da cobrança (Story 6.2): faixa_guias (tabela por classe, padrão) ou percentual_producao (percentual × valor cobrado da produção — médicos auxiliares).';
comment on column medicos.percentual_producao is
  'Percentual sobre o valor COBRADO da produção (ex.: 5.00 = 5%). Obrigatório e > 0 quando modo_cobranca = percentual_producao.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table medicos drop constraint if exists chk_medicos_percentual_producao;
-- alter table medicos drop constraint if exists chk_medicos_modo_cobranca;
-- alter table medicos drop column if exists percentual_producao, drop column if exists modo_cobranca;
