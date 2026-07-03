-- Migration 0008 — view vw_recebiveis (Contas a Receber, Story 4.4).
-- Fonte: docs/architecture/feature-ciclo-financeiro.md §5.3.
-- Junta boletos + execucao_resultados + execucoes e calcula o STATUS DERIVADO on-read
-- (pago/cancelado/vencido/em_aberto). 'vencido' NÃO é armazenado — é derivado aqui.
--
-- Segurança: view com `security_invoker = on` — respeita a RLS das tabelas base para QUEM consulta.
--   - Acesso do app é sempre server-side via service role (bypassa RLS) no recebiveis-repository,
--     e a rota GET /api/recebiveis já faz requireRole(admin/financeiro).
--   - Com security_invoker, se a view for consultada por um usuário autenticado comum, a RLS de
--     `boletos` (leitura só admin/financeiro, migration 0004) é aplicada → não vaza dado. Defesa
--     em profundidade sem depender só da checagem na rota. (Requer Postgres 15+; projeto roda PG17.)
--
-- Idempotente: create or replace view. Rollback comentado no rodapé.

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
  join execucoes e           on e.id = r.execucao_id;

comment on view vw_recebiveis is
  'Contas a Receber: boletos + resultado + competencia com status derivado (pago/cancelado/vencido/em_aberto). security_invoker=on respeita a RLS das tabelas base.';

-- ============================================================================
-- Índices — o access pattern (join + filtros por competência/médico/status_derivado) é coberto:
--   - boletos.execucao_resultado_id: idx_boletos_resultado (0004)
--   - execucao_resultados.execucao_id: idx_execucao_resultados_execucao (0001)
--   - boletos.vencimento / boletos.status: idx_boletos_vencimento / idx_boletos_status (0007)
--   - execucao_resultados.id / execucoes.id: PKs
-- status_derivado é calculado (não indexável diretamente); o volume é baixo (~120 boletos/mês),
-- então filtro em memória/na query é aceitável. Reavaliar se o volume crescer muito.
-- Sem novos índices nesta migration.
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop view if exists vw_recebiveis;
