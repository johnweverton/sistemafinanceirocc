-- Migration 0042 — dimensão `conta_emissora` no Dashboard.
-- Contexto: a coordenadora financeira quer ver "quanto foi emitido pela MC" vs "quanto foi
-- emitido pela Cavalcante Viana" etc no dashboard — o filtro por conta emissora já existe em
-- Contas a Receber (RecebiveisManager) e no DRE (DreManager), mas não no Dashboard. `vw_recebiveis`
-- já expõe `conta_emissora` desde a migration 0021 (ampliada para 4 contas na 0040); faltava
-- propagar essa coluna para as 3 views agregadas do dashboard.
--
-- Solução: mesmo padrão da 0010 (dimensão opcional via GROUPING SETS) — `conta_emissora` entra
-- como MAIS UMA dimensão opcional, ortogonal a `competencia`:
--   - visão de uma conta específica → filtra `conta_emissora = X`
--   - visão "Todas as contas"       → filtra `conta_emissora IS NULL` (linha de rollup)
-- Os dois filtros (competencia, conta_emissora) são independentes — qualquer combinação dos dois
-- (ambos, só um, nenhum) já existe como uma linha própria na view, agregada no banco.
--
-- Segurança: mantém `security_invoker = on`. Idempotente (create or replace). Coluna nova sempre
-- no FINAL do SELECT (create or replace view não aceita inserção no meio — mesma observação da
-- 0021/QA-711-1). Rollback comentado no rodapé.

-- ============================================================================
-- 1. Por competência (+ conta emissora) — grouping sets: ambas dimensões, só competencia,
--    só conta_emissora, ou nenhuma (rollup total geral).
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
  )                                                                 as taxa_inadimplencia,
  conta_emissora
from vw_recebiveis
group by grouping sets ((competencia, conta_emissora), (competencia), (conta_emissora), ());

comment on view vw_dashboard_competencia is
  'Dashboard: totais por competência × conta emissora (dimensões opcionais independentes via GROUPING SETS) + linha de rollup total geral, com taxa de inadimplência agregada no banco.';

-- ============================================================================
-- 2. Por médico (por competência × conta emissora + rollups) — competencia/conta_emissora como
--    ÚLTIMAS colunas (create-or-replace só permite ADICIONAR colunas ao final; conta_emissora
--    entra DEPOIS de competencia, que já era a última coluna antes desta migration).
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
  competencia,
  conta_emissora
from vw_recebiveis
group by grouping sets (
  (medico_id, nome, competencia, conta_emissora),
  (medico_id, nome, competencia),
  (medico_id, nome, conta_emissora),
  (medico_id, nome)
);

comment on view vw_dashboard_medico is
  'Dashboard: totais por médico × competência × conta emissora (dimensões opcionais independentes) + rollups. Ticket médio e inadimplência agregados no banco.';

-- ============================================================================
-- 3. Aging de vencidos (por competência × conta emissora + rollups) — competencia/conta_emissora
--    como ÚLTIMAS colunas.
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
  competencia,
  conta_emissora
from vw_recebiveis
where status_derivado = 'vencido'
  and vencimento is not null
group by grouping sets (
  (case
    when (current_date - vencimento) <= 30 then '0-30'
    when (current_date - vencimento) <= 60 then '31-60'
    else '60+'
  end, competencia, conta_emissora),
  (case
    when (current_date - vencimento) <= 30 then '0-30'
    when (current_date - vencimento) <= 60 then '31-60'
    else '60+'
  end, competencia),
  (case
    when (current_date - vencimento) <= 30 then '0-30'
    when (current_date - vencimento) <= 60 then '31-60'
    else '60+'
  end, conta_emissora),
  (case
    when (current_date - vencimento) <= 30 then '0-30'
    when (current_date - vencimento) <= 60 then '31-60'
    else '60+'
  end)
);

comment on view vw_dashboard_aging is
  'Dashboard: aging de vencidos por faixa × competência × conta emissora (dimensões opcionais independentes) + rollups.';

-- ============================================================================
-- Índices — inalterados. Mesma observação da 0010: volume baixo, agregação com grouping sets
-- sobre vw_recebiveis é barata; os índices de 0004/0007/0021 cobrem os joins/filtros da base.
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar manualmente) — não há uma migration anterior exata a restaurar, já que esta
-- migration é ADITIVA (só acrescenta a dimensão conta_emissora às views existentes). Para reverter,
-- reaplicar a definição das 3 views tal como estavam na migration 0010 (sem a coluna conta_emissora
-- e sem as combinações de grouping sets que a incluem).
-- ============================================================================
