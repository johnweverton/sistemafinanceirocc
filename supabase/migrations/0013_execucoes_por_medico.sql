-- Migration 0013 — índice em execucao_resultados(medico_id) + view de resumo por médico.
-- Motivo: a visão "Por médico" (histórico de execuções) cruza execucao_resultados com
-- execucoes por medico_id; sem índice, qualquer filtro/agrupamento nessa coluna faz table
-- scan — a tabela cresce O(médicos × competências) e pode chegar a dezenas de milhares de
-- linhas com o tempo.
--
-- IMPORTANTE (mesma observação de todas as migrations deste projeto): entregue pelo dev,
-- aplicada MANUALMENTE pelo dono via SQL editor do Supabase Studio ou `supabase db push`.
-- Sem essa migration aplicada, as rotas GET /api/execucoes/por-medico[/historico] falham.
--
-- Idempotente: create index if not exists / create or replace view. Rollback comentado no rodapé.

create index if not exists idx_execucao_resultados_medico on execucao_resultados (medico_id);

-- 1 linha por médico (chave = medico_id, com fallback pra cpf quando medico_id é nulo —
-- médico não vinculado ao cadastro no momento da execução), com a ocorrência mais recente
-- (maior competência) e a contagem total de ocorrências.
-- security_invoker = on: mesma política de 0008_vw_recebiveis.sql — respeita a RLS das
-- tabelas base para QUEM consulta; o acesso do app é sempre server-side via service role
-- (bypassa RLS) no execucao-repository, com requireRole(admin/colaborador/financeiro) na rota.
create or replace view vw_execucoes_resumo_medico
with (security_invoker = on) as
select distinct on (coalesce(er.medico_id::text, er.cpf))
  er.medico_id    as medico_id,
  er.cpf          as cpf,
  er.nome         as nome,
  e.competencia   as ultima_competencia,
  er.execucao_id  as ultima_execucao_id,
  e.status        as ultima_execucao_status,
  er.status       as ultimo_status_resultado,
  er.total_valor  as ultimo_valor,
  count(*) over (partition by coalesce(er.medico_id::text, er.cpf)) as qtd_execucoes
from execucao_resultados er
  join execucoes e on e.id = er.execucao_id
order by coalesce(er.medico_id::text, er.cpf), e.competencia desc, e.iniciado_em desc;

comment on view vw_execucoes_resumo_medico is
  'Um médico por linha: ocorrência mais recente + contagem total, base da visão "Por médico" no histórico de execuções.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop view if exists vw_execucoes_resumo_medico;
-- drop index if exists idx_execucao_resultados_medico;
