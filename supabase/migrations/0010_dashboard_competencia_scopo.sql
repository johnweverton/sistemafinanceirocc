-- Migration 0010 — dimensão `competencia` no Dashboard (resolve ressalvas do QA da Story 4.6).
-- Fonte: docs/architecture/feature-ciclo-financeiro.md §6 + QA Results 4.6.
--
-- Motivação (2 ressalvas Low do QA):
--   [1] vw_dashboard_medico / vw_dashboard_aging eram GLOBAIS (não filtravam por competência).
--   [2] taxa de inadimplência era recomputada no cliente para a visão "Todas".
--
-- Solução: recriar as 3 views com a dimensão `competencia` usando GROUPING SETS, que geram numa
-- única view TANTO as linhas por competência QUANTO uma linha de rollup (competencia IS NULL = total
-- geral / "Todas") — com a taxa/ticket agregados corretamente no BANCO. Assim:
--   - visão de uma competência  → filtra `competencia = X`
--   - visão "Todas"             → filtra `competencia IS NULL` (linha de rollup)
-- A regra de status derivado continua ÚNICA (reuso de vw_recebiveis). Sem recomputo no cliente.
--
-- Segurança: mantém `security_invoker = on` (respeita RLS das tabelas base). Idempotente
-- (create or replace). Rollback comentado no rodapé (restaura as views globais da 0009).

-- ============================================================================
-- 1. Por competência (+ linha de rollup total geral)
-- ============================================================================
create or replace view vw_dashboard_competencia
with (security_invoker = on) as
select
  competencia,
  count(*)                                                          as qtd_boletos,
  coalesce(sum(valor), 0)                                           as total_emitido,
  coalesce(sum(valor_pago) filter (where status_derivado = 'pago'), 0)      as total_recebido,
  coalesce(sum(valor)      filter (where status_derivado = 'em_aberto'), 0) as total_em_aberto,
  coalesce(sum(valor)      filter (where status_derivado = 'vencido'), 0)   as total_vencido,
  coalesce(
    sum(valor) filter (where status_derivado = 'vencido') / nullif(sum(valor), 0),
    0
  )                                                                 as taxa_inadimplencia
from vw_recebiveis
group by grouping sets ((competencia), ());  -- () → linha total geral (competencia IS NULL)

comment on view vw_dashboard_competencia is
  'Dashboard: totais por competência + linha de rollup (competencia IS NULL = total geral) com taxa de inadimplência agregada no banco.';

-- ============================================================================
-- 2. Por médico (por competência + rollup por médico) — competencia como ÚLTIMA coluna
--    (create-or-replace só permite ADICIONAR colunas ao final).
-- ============================================================================
create or replace view vw_dashboard_medico
with (security_invoker = on) as
select
  medico_id,
  nome,
  count(*)                                                          as qtd_boletos,
  coalesce(sum(valor), 0)                                           as total_emitido,
  coalesce(sum(valor_pago) filter (where status_derivado = 'pago'), 0)      as total_recebido,
  coalesce(sum(valor)      filter (where status_derivado = 'em_aberto'), 0) as total_em_aberto,
  coalesce(sum(valor)      filter (where status_derivado = 'vencido'), 0)   as total_vencido,
  coalesce(
    sum(valor) filter (where status_derivado = 'vencido') / nullif(sum(valor), 0),
    0
  )                                                                 as taxa_inadimplencia,
  coalesce(sum(valor) / nullif(count(*), 0), 0)                     as ticket_medio,
  competencia
from vw_recebiveis
group by grouping sets ((medico_id, nome, competencia), (medico_id, nome));

comment on view vw_dashboard_medico is
  'Dashboard: totais por médico por competência + rollup (competencia IS NULL = todas). Ticket médio e inadimplência agregados no banco.';

-- ============================================================================
-- 3. Aging de vencidos (por competência + rollup) — competencia como ÚLTIMA coluna
-- ============================================================================
create or replace view vw_dashboard_aging
with (security_invoker = on) as
select
  case
    when (current_date - vencimento) <= 30 then '0-30'
    when (current_date - vencimento) <= 60 then '31-60'
    else '60+'
  end                       as faixa,
  count(*)                  as qtd,
  coalesce(sum(valor), 0)   as total,
  competencia
from vw_recebiveis
where status_derivado = 'vencido'
  and vencimento is not null
group by grouping sets (
  (case
    when (current_date - vencimento) <= 30 then '0-30'
    when (current_date - vencimento) <= 60 then '31-60'
    else '60+'
  end, competencia),
  (case
    when (current_date - vencimento) <= 30 then '0-30'
    when (current_date - vencimento) <= 60 then '31-60'
    else '60+'
  end)
);

comment on view vw_dashboard_aging is
  'Dashboard: aging de vencidos por faixa por competência + rollup (competencia IS NULL = todas).';

-- ============================================================================
-- Índices — inalterados. Volume ~120 boletos/mês; agregação com grouping sets sobre vw_recebiveis
-- é barata. Os índices de 0004/0007 cobrem os joins/filtros da view base.
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar manualmente) — restaura as views globais da migration 0009.
-- ============================================================================
-- Reaplicar o conteúdo de 0009_dashboard_agregacoes.sql (views sem a dimensão competencia).
