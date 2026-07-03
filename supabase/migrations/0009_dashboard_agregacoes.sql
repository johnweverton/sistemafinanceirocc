-- Migration 0009 — views de agregação do Dashboard financeiro (Story 4.5).
-- Fonte: docs/architecture/feature-ciclo-financeiro.md §6.
-- REUSAM a view vw_recebiveis (0008) como base → a regra de status derivado é ÚNICA e não diverge
-- entre Contas a Receber e o Dashboard (consistência apontada pelo arquiteto).
--
-- Segurança: todas com `security_invoker = on` (como a 0008) — respeitam a RLS das tabelas base
-- para quem consulta. Acesso do app é server-side via service role (bypassa RLS) no
-- dashboard-repository, e a rota GET /api/dashboard/* já faz requireRole(admin/financeiro).
--
-- Idempotente: create or replace view. Rollback comentado no rodapé.

-- ============================================================================
-- 1. Por competência
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
  -- taxa de inadimplência = vencido / emitido (0 quando não há emitido)
  coalesce(
    sum(valor) filter (where status_derivado = 'vencido') / nullif(sum(valor), 0),
    0
  )                                                                 as taxa_inadimplencia
from vw_recebiveis
group by competencia;

comment on view vw_dashboard_competencia is
  'Dashboard: totais por competência (emitido/recebido/em aberto/vencido) + taxa de inadimplência.';

-- ============================================================================
-- 2. Por médico
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
  -- ticket médio = emitido / qtd de boletos
  coalesce(sum(valor) / nullif(count(*), 0), 0)                     as ticket_medio
from vw_recebiveis
group by medico_id, nome;

comment on view vw_dashboard_medico is
  'Dashboard: totais por médico + ticket médio + taxa de inadimplência.';

-- ============================================================================
-- 3. Aging de vencidos (faixas de atraso)
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
  coalesce(sum(valor), 0)   as total
from vw_recebiveis
where status_derivado = 'vencido'
  and vencimento is not null
group by 1;

comment on view vw_dashboard_aging is
  'Dashboard: aging de boletos vencidos por faixa de atraso (0-30, 31-60, 60+ dias).';

-- ============================================================================
-- Índices — as agregações leem de vw_recebiveis (→ boletos + joins). O access pattern já é coberto
-- pelos índices de 0004/0007 (execucao_resultado_id, vencimento, status). Volume ~120/mês →
-- full scan agregado é barato. Sem novos índices.
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop view if exists vw_dashboard_competencia;
-- drop view if exists vw_dashboard_medico;
-- drop view if exists vw_dashboard_aging;
