-- Migration 0029 — execução e resultado agregado por empresa (Story 10.4b, Épico 10).
-- Depende da 10.4a (tabela `empresas`). Ver desenho do @architect em
-- docs/stories/10.4.emissao-por-empresa-medisa.story.md.

-- ============================================================================
-- 1. execucoes.empresa_id — marca uma execução como agregada por empresa
-- ============================================================================
alter table execucoes
  add column if not exists empresa_id uuid references empresas(id);

comment on column execucoes.empresa_id is
  'Marca esta execução como agregada por empresa (Story 10.4b) — soma a produção de vários médicos num único resultado. NULL = execução normal por médico (comportamento atual, inalterado).';

-- ============================================================================
-- 2. execucao_resultados.empresa_id — resultado agregado da empresa
-- ============================================================================
-- DESVIO CONSCIENTE do desenho original: a story propôs CHECK
-- `(medico_id is not null) <> (empresa_id is not null)` (XOR estrito). Achado do @dev na
-- implementação: isso quebraria dados legados válidos — `execucao_resultados.medico_id` já é
-- nullable desde a migration 0011 para o caso "médico importado sem vínculo ainda", identificado
-- por `cpf` (ver historicoResultadosPorMedico em execucao-repository.ts, filtro por cpf com
-- `medico_id is null`). Nesses registros medico_id E empresa_id ficariam AMBOS null, falhando
-- um XOR estrito. A CHECK abaixo é mais fraca (só proíbe os dois setados AO MESMO TEMPO — a
-- ambiguidade real que queremos evitar), compatível com o legado.
alter table execucao_resultados
  add column if not exists empresa_id uuid references empresas(id);

alter table execucao_resultados drop constraint if exists chk_execucao_resultados_nao_ambos_medico_empresa;
alter table execucao_resultados add constraint chk_execucao_resultados_nao_ambos_medico_empresa
  check (not (medico_id is not null and empresa_id is not null));

comment on column execucao_resultados.empresa_id is
  'Resultado AGREGADO de uma empresa (Story 10.4b) — soma da produção de vários médicos. Mutuamente exclusivo com medico_id (nunca os dois setados), mas ambos podem ser null (médico legado sem vínculo, identificado por cpf — ver migration 0011).';

-- ============================================================================
-- 3. execucao_resultado_contribuicoes — auditoria por médico do resultado agregado
-- ============================================================================
create table if not exists execucao_resultado_contribuicoes (
  id uuid primary key default gen_random_uuid(),
  execucao_resultado_id uuid not null references execucao_resultados(id),
  medico_id uuid not null references medicos(id),
  guias integer not null,
  valor numeric(10,2) not null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_execucao_resultado_contribuicoes_resultado
  on execucao_resultado_contribuicoes (execucao_resultado_id);

comment on table execucao_resultado_contribuicoes is
  'Auditoria por médico de um resultado AGREGADO por empresa (Story 10.4b) — "qual médico contribuiu quanto" para disputa/conferência. Uma linha por médico que contribuiu guias para o resultado da empresa.';

-- ============================================================================
-- RLS — mesmo padrão de execucao_resultados (migration 0015): leitura autenticada, escrita
-- só via service role (orquestrador).
-- ============================================================================
alter table execucao_resultado_contribuicoes enable row level security;

drop policy if exists execucao_resultado_contribuicoes_select on execucao_resultado_contribuicoes;
create policy execucao_resultado_contribuicoes_select on execucao_resultado_contribuicoes
  for select using (has_profile());

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop policy if exists execucao_resultado_contribuicoes_select on execucao_resultado_contribuicoes;
-- drop table if exists execucao_resultado_contribuicoes;
-- alter table execucao_resultados drop constraint if exists chk_execucao_resultados_nao_ambos_medico_empresa;
-- alter table execucao_resultados drop column if exists empresa_id;
-- alter table execucoes drop column if exists empresa_id;
