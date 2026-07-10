-- Migration 0020 — exclui boletos com falha de emissão da vw_recebiveis.
-- Bug encontrado em produção (2026-07-09): tentativas de emissão que falharam (status='falha')
-- apareciam em Contas a Receber como "em aberto" — 4 linhas falsas de R$ 5,00 ao lado do boleto
-- realmente emitido, todas sem PDF/id_externo. Falha de emissão é auditoria (fica na tabela
-- boletos), não é recebível. As views de dashboard (0009) reutilizam esta view, então os
-- agregados financeiros também deixam de ser inflados pelas falhas.
--
-- Mesma definição da 0008 + filtro `b.status <> 'falha'`. Idempotente: create or replace view.

create or replace view vw_recebiveis
with (security_invoker = on) as
select
  b.id                       as boleto_id,
  b.execucao_resultado_id    as execucao_resultado_id,
  b.id_externo               as id_externo,
  e.competencia              as competencia,
  r.medico_id                as medico_id,
  r.nome                     as nome,
  r.total_valor              as valor,
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
  end                        as status_derivado
from boletos b
  join execucao_resultados r on r.id = b.execucao_resultado_id
  join execucoes e           on e.id = r.execucao_id
where b.status <> 'falha';

comment on view vw_recebiveis is
  'Contas a Receber: boletos + resultado + competencia com status derivado (pago/cancelado/vencido/em_aberto). Exclui falhas de emissão (auditoria, não recebível). security_invoker=on respeita a RLS das tabelas base.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- Reaplicar a definição da 0008 (sem o where).
