-- Migration 0049 — dimensão `tipo_servico` (Cobrança Médica vs Contabilidade), feedback do
-- dono 2026-08-19.
--
-- Achado ao investigar: `conta_emissora` NÃO é um proxy confiável de "tipo de serviço" — a
-- migration 0040 liberou deliberadamente as 4 contas pra QUALQUER boleto do sistema (um médico
-- pode estar configurado em carmem_cavalcante; um cliente contábil pode estar em mc). O único
-- sinal que diz a verdade é `execucao_resultados.cliente_contabilidade_id` (migration 0032) —
-- setado SÓ quando o resultado é de cliente contábil, mutuamente exclusivo com medico_id/
-- empresa_id (chk_execucao_resultados_exclusao_mutua). `vw_recebiveis` nunca expôs essa coluna.
--
-- Solução: mesmo padrão da 0021 (expor a coluna) + 0042 (nova dimensão independente nas views
-- agregadas do Dashboard, mas agora via CUBE em vez de GROUPING SETS manual — equivalente,
-- CUBE(a,b,c) = todas as 2³ combinações, mais legível que enumerar 8 conjuntos à mão).
--
-- Aditiva/idempotente (create or replace view). Coluna nova sempre no FINAL do SELECT
-- (QA-711-1 — create or replace view não aceita inserção no meio). Rollback comentado no rodapé.

-- ============================================================================
-- 1. vw_recebiveis — expõe cliente_contabilidade_id + tipo_servico derivado.
-- ============================================================================
create or replace view vw_recebiveis
with (security_invoker = on) as
select
  b.id                       as boleto_id,
  b.execucao_resultado_id    as execucao_resultado_id,
  b.id_externo               as id_externo,
  e.competencia              as competencia,
  r.medico_id                as medico_id,
  r.nome                     as nome,
  r.total_valor               as valor,
  b.vencimento               as vencimento,
  b.pago_em                  as pago_em,
  b.valor_pago               as valor_pago,
  b.emitido_em               as emitido_em,
  case
    when b.pago_em is not null or b.status = 'pago' then 'pago'
    when b.status = 'cancelado'                     then 'cancelado'
    when b.vencimento is not null
         and b.vencimento < current_date            then 'vencido'
    else 'em_aberto'
  end                        as status_derivado,
  b.conta_emissora           as conta_emissora,
  r.cliente_contabilidade_id as cliente_contabilidade_id,
  case
    when r.cliente_contabilidade_id is not null then 'contabilidade'
    else 'cobranca_medica'
  end                        as tipo_servico
from boletos b
  join execucao_resultados r on r.id = b.execucao_resultado_id
  join execucoes e           on e.id = r.execucao_id
where b.status not in ('falha', 'processando');

comment on view vw_recebiveis is
  'Contas a Receber: boletos + resultado + competencia com status derivado (pago/cancelado/vencido/em_aberto), conta emissora (Épico 7) e tipo de serviço (cobranca_medica/contabilidade, migration 0049 — derivado de cliente_contabilidade_id, NUNCA de conta_emissora). Exclui falhas de emissão e reservas ainda não confirmadas pelo gateway. security_invoker=on respeita a RLS das tabelas base.';

-- ============================================================================
-- 2. vw_dashboard_competencia — tipo_servico como 3ª dimensão independente via CUBE.
--    Preserva o `where status_derivado <> 'cancelado'` da migration 0043.
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
  conta_emissora,
  tipo_servico
from vw_recebiveis
where status_derivado <> 'cancelado'
group by cube (competencia, conta_emissora, tipo_servico);

comment on view vw_dashboard_competencia is
  'Dashboard: totais por competência × conta emissora × tipo de serviço (dimensões opcionais independentes via CUBE — equivalente a GROUPING SETS com as 2³ combinações) + linha de rollup total geral, com taxa de inadimplência agregada no banco. Exclui boletos cancelados (migration 0043).';

-- ============================================================================
-- 3. vw_dashboard_medico — (medico_id, nome) sempre fixos + CUBE nas 3 dimensões opcionais.
--    Cliente contábil aparece aqui com medico_id NULL e nome = nome do cliente (mesmo desenho
--    de sempre); filtrar tipo_servico='contabilidade' isola essas linhas — é o "relatório dos
--    clientes de contabilidade" pedido pelo dono, sem precisar de view nova.
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
  conta_emissora,
  tipo_servico
from vw_recebiveis
where status_derivado <> 'cancelado'
group by medico_id, nome, cube (competencia, conta_emissora, tipo_servico);

comment on view vw_dashboard_medico is
  'Dashboard: totais por médico/cliente-contábil × competência × conta emissora × tipo de serviço (3 dimensões opcionais independentes via CUBE) + rollups. Ticket médio e inadimplência agregados no banco. Exclui boletos cancelados (migration 0043).';

-- ============================================================================
-- 4. vw_dashboard_aging — faixa sempre fixa + CUBE nas 3 dimensões opcionais.
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
  conta_emissora,
  tipo_servico
from vw_recebiveis
where status_derivado = 'vencido'
  and vencimento is not null
group by
  case
    when (current_date - vencimento) <= 30 then '0-30'
    when (current_date - vencimento) <= 60 then '31-60'
    else '60+'
  end,
  cube (competencia, conta_emissora, tipo_servico);

comment on view vw_dashboard_aging is
  'Dashboard: aging de vencidos por faixa × competência × conta emissora × tipo de serviço (3 dimensões opcionais independentes via CUBE) + rollups.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário) — reaplica a definição exata da 0043/0042
-- (sem cliente_contabilidade_id/tipo_servico e sem a 3ª dimensão nas views agregadas).
-- ============================================================================
-- Ver supabase/migrations/0043_dashboard_exclui_cancelado.sql (vw_dashboard_competencia/medico)
-- e 0042_dashboard_conta_emissora.sql (vw_dashboard_aging) para as definições anteriores exatas.
