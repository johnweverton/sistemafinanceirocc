-- Migration 0043 — exclui boletos cancelados dos totais agregados do Dashboard.
--
-- Bug real em produção (achado 2026-08-06, Dr. Mateus Gomes Frota): competência 2026-07 teve a
-- execução rodada MAIS DE UMA VEZ pra ele (5 linhas em execucao_resultados, mesmo total_valor
-- 1.330,16 cada — reprocessamento, não um recálculo em cima da mesma linha). Um boleto foi
-- emitido sobre uma dessas linhas e depois CANCELADO (corretamente, era duplicata); um segundo
-- boleto foi emitido sobre outra linha e PAGO (o boleto real, válido). Resultado no Dashboard:
-- "Emitido" mostrou R$ 2.660,32 (soma dos DOIS boletos, incluindo o cancelado) quando só
-- R$ 1.330,16 é o valor real e vigente — parecia que o cliente tinha pago só metade do que foi
-- emitido, quando na verdade só existe 1 boleto ativo, já pago integralmente.
--
-- Causa: vw_dashboard_competencia e vw_dashboard_medico (0009, redefinidas por último na 0042)
-- fazem `coalesce(sum(valor), 0) as total_emitido` sobre TODAS as linhas de vw_recebiveis, sem
-- filtrar `status_derivado`. total_recebido/em_aberto/vencido já usam FILTER (where
-- status_derivado = '...'), então nunca somaram cancelado — mas total_emitido, qtd_boletos e
-- ticket_medio (que depende de count(*) e sum(valor) sem filtro) somavam TUDO, inclusive
-- boletos com status_derivado = 'cancelado'. taxa_inadimplencia também ficava com o
-- denominador inflado pelo cancelado (nullif(sum(valor), 0)).
--
-- A migration 0017 (cancelamento ativo) já documentava a intenção — "cancelado nunca entra em
-- em_aberto/vencido" — mas não cobriu o total_emitido/ticket_medio/qtd_boletos, que não têm
-- FILTER nenhum.
--
-- vw_recebiveis (Contas a Receber) NÃO muda — cancelado continua aparecendo lá, listado boleto a
-- boleto com o badge "Cancelado" (auditoria/trilha, RecebiveisManager.tsx). Só as duas views
-- AGREGADAS do Dashboard passam a ignorar linhas canceladas na base do agrupamento.
--
-- Aditiva/idempotente: create or replace view. Rollback comentado no rodapé.

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
where status_derivado <> 'cancelado'
group by grouping sets ((competencia, conta_emissora), (competencia), (conta_emissora), ());

comment on view vw_dashboard_competencia is
  'Dashboard: totais por competência × conta emissora (dimensões opcionais independentes via GROUPING SETS) + linha de rollup total geral, com taxa de inadimplência agregada no banco. Exclui boletos cancelados (migration 0043) — um boleto cancelado não é receita emitida.';

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
where status_derivado <> 'cancelado'
group by grouping sets (
  (medico_id, nome, competencia, conta_emissora),
  (medico_id, nome, competencia),
  (medico_id, nome, conta_emissora),
  (medico_id, nome)
);

comment on view vw_dashboard_medico is
  'Dashboard: totais por médico × competência × conta emissora (dimensões opcionais independentes) + rollups. Ticket médio e inadimplência agregados no banco. Exclui boletos cancelados (migration 0043) — um boleto cancelado não é receita emitida.';

-- vw_dashboard_aging não muda: já filtra `where status_derivado = 'vencido'`, que por
-- definição (CASE de vw_recebiveis) já exclui 'cancelado'.

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário) — reaplica a definição exata da 0042 (sem o
-- `where status_derivado <> 'cancelado'`).
-- ============================================================================
-- create or replace view vw_dashboard_competencia
-- with (security_invoker = on) as
-- select
--   competencia,
--   count(*)                                                          as qtd_boletos,
--   coalesce(sum(valor), 0)                                           as total_emitido,
--   coalesce(sum(valor_pago) filter (where status_derivado = 'pago'), 0)      as total_recebido,
--   coalesce(sum(valor)      filter (where status_derivado = 'em_aberto'), 0) as total_em_aberto,
--   coalesce(sum(valor)      filter (where status_derivado = 'vencido'), 0)   as total_vencido,
--   coalesce(
--     sum(valor) filter (where status_derivado = 'vencido') / nullif(sum(valor), 0),
--     0
--   )                                                                 as taxa_inadimplencia,
--   conta_emissora
-- from vw_recebiveis
-- group by grouping sets ((competencia, conta_emissora), (competencia), (conta_emissora), ());
--
-- create or replace view vw_dashboard_medico
-- with (security_invoker = on) as
-- select
--   medico_id,
--   nome,
--   count(*)                                                          as qtd_boletos,
--   coalesce(sum(valor), 0)                                           as total_emitido,
--   coalesce(sum(valor_pago) filter (where status_derivado = 'pago'), 0)      as total_recebido,
--   coalesce(sum(valor)      filter (where status_derivado = 'em_aberto'), 0) as total_em_aberto,
--   coalesce(sum(valor)      filter (where status_derivado = 'vencido'), 0)   as total_vencido,
--   coalesce(
--     sum(valor) filter (where status_derivado = 'vencido') / nullif(sum(valor), 0),
--     0
--   )                                                                 as taxa_inadimplencia,
--   coalesce(sum(valor) / nullif(count(*), 0), 0)                     as ticket_medio,
--   competencia,
--   conta_emissora
-- from vw_recebiveis
-- group by grouping sets (
--   (medico_id, nome, competencia, conta_emissora),
--   (medico_id, nome, competencia),
--   (medico_id, nome, conta_emissora),
--   (medico_id, nome)
-- );
