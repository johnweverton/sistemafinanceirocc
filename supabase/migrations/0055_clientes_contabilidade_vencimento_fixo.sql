-- Migration 0055 — vencimento em dia fixo do mês para clientes contábeis (Story 11.1-A).
-- Alguns clientes de contabilidade exigem que o boleto vença sempre no mesmo dia do mês
-- (ex.: dia 10, dia 12), em vez do padrão de dias corridos a partir da emissão já existente
-- (`dias_vencimento`, migration 0030). Alternativa aditiva — não substitui `dias_vencimento`.

alter table clientes_contabilidade add column if not exists modo_vencimento text;
alter table clientes_contabilidade add column if not exists dia_fixo_vencimento smallint;

alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_modo_vencimento;
alter table clientes_contabilidade add constraint chk_clientes_contabilidade_modo_vencimento
  check (modo_vencimento is null or modo_vencimento in ('dias_corridos', 'dia_fixo'));

alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_dia_fixo_vencimento;
alter table clientes_contabilidade add constraint chk_clientes_contabilidade_dia_fixo_vencimento
  check (
    modo_vencimento is distinct from 'dia_fixo'
    or (dia_fixo_vencimento is not null and dia_fixo_vencimento between 1 and 31)
  );

comment on column clientes_contabilidade.modo_vencimento is
  'Modo de vencimento do boleto: dias_corridos (padrão, usa dias_vencimento) ou dia_fixo (usa dia_fixo_vencimento, Story 11.1-A).';
comment on column clientes_contabilidade.dia_fixo_vencimento is
  'Dia do mês (1-31) usado quando modo_vencimento = dia_fixo. Meses mais curtos usam o último dia real (calculado em runtime, não no banco).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_dia_fixo_vencimento;
-- alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_modo_vencimento;
-- alter table clientes_contabilidade drop column if exists dia_fixo_vencimento;
-- alter table clientes_contabilidade drop column if exists modo_vencimento;
