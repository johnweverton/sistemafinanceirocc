-- Migration 0011 — integração com a API real do Sistema Web (Épico 5).
-- Fonte: docs/architecture/feature-integracao-api-financeiro.md (§3.4, §4).
--
-- Mudanças (todas aditivas/relaxantes — sem quebra do fluxo atual):
--   1. medicos.external_id  — vínculo permanente com fin-clientes.id da origem.
--   2. medicos.cpf nullable — CPF deixa de ser chave interna e vira dado cadastral
--      (médicos importados da API chegam sem CPF; completude via pendências de cadastro).
--   3. execucao_selecoes    — snapshot da seleção manual de produção por execução
--      (decisão 7 do épico: auditoria de "qual produção alimentou qual resultado").
--   4. execucao_resultados.cpf nullable — chave interna passa a ser medico_id.
--   5. Índice em execucao_resultados(medico_id) — guiasExecucaoAnterior passa a
--      consultar por medico_id (mudança de app na story 5.5).
--
-- Sem impacto em views: vw_recebiveis (0008) e vw_dashboard_* (0009/0010) usam
-- medico_id/nome, não cpf. Sem nova PII: patient_name da API NÃO é persistido.
-- Idempotência: guards IF NOT EXISTS / IF EXISTS onde o Postgres permite.
-- Rollback comentado no rodapé.

-- ============================================================================
-- 1. medicos.external_id — vínculo com a origem (fin-clientes.id)
-- ============================================================================
alter table medicos
  add column if not exists external_id uuid;

-- UNIQUE parcial: um cliente da origem vincula a no máximo um médico local.
-- Parcial (WHERE not null) porque médicos legados/CSV podem nunca ter vínculo.
create unique index if not exists uq_medicos_external_id
  on medicos (external_id)
  where external_id is not null;

comment on column medicos.external_id is
  'UUID do médico na origem (fin-clientes.id da API do sistema web). Vínculo permanente — nunca reatribuir (Épico 5, decisão 4).';

-- ============================================================================
-- 2. medicos.cpf — deixa de ser NOT NULL (segue UNIQUE)
-- ============================================================================
-- Médico importado da API chega sem CPF (a origem ainda não expõe o campo).
-- A constraint UNIQUE original (medicos_cpf_key, 0001) é MANTIDA: no Postgres,
-- NULLs são distintos entre si em UNIQUE — vários médicos sem CPF convivem,
-- e CPF preenchido continua único. Não é preciso índice parcial novo.
alter table medicos
  alter column cpf drop not null;

comment on column medicos.cpf is
  'CPF do médico (11 dígitos). Desde a 0011 é dado CADASTRAL (nullable) — a chave interna é medicos.id e o vínculo com a origem é external_id. NULL = pendência de cadastro (Épico 5, §3.4 da arquitetura).';

-- ============================================================================
-- 3. execucao_selecoes — snapshot da seleção manual de produção (decisão 7)
-- ============================================================================
-- Tabela própria (não jsonb em execucoes): FK garante integridade referencial,
-- e a auditoria fica consultável ("qual produção alimentou o resultado do médico X").
create table if not exists execucao_selecoes (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references execucoes(id),
  medico_id uuid not null references medicos(id),
  producao_externa_id uuid not null,   -- fin-producoes.id na origem
  producao_nome text not null,         -- snapshot do nome exibido ao usuário na escolha
  created_at timestamptz not null default now(),
  -- um médico entra no máximo uma vez por execução
  constraint uq_execucao_selecoes unique (execucao_id, medico_id)
);
-- O UNIQUE (execucao_id, medico_id) já indexa o access pattern principal
-- (listar seleções de uma execução) — sem índice adicional.

comment on table execucao_selecoes is
  'Snapshot da seleção manual de produção por execução (Épico 5, decisão 7). Escrita só via service role no início da execução; imutável depois.';

-- RLS: espelha o padrão de execucao_resultados (0002) — autenticado lê,
-- escrita apenas via service role (repositórios server-side).
alter table execucao_selecoes enable row level security;

drop policy if exists execucao_selecoes_select on execucao_selecoes;
create policy execucao_selecoes_select on execucao_selecoes
  for select using (auth.role() = 'authenticated');
-- (sem policy de insert/update/delete → clientes não escrevem; service role bypassa RLS)

-- ============================================================================
-- 4. execucao_resultados.cpf — snapshot informativo (nullable)
-- ============================================================================
alter table execucao_resultados
  alter column cpf drop not null;

comment on column execucao_resultados.cpf is
  'Snapshot informativo do CPF no momento da execução; pode ser NULL para médico importado ainda sem CPF. Chave de cruzamento é medico_id (Épico 5, §3.4).';

-- ============================================================================
-- 5. Índice para histórico por médico (guiasExecucaoAnterior → medico_id)
-- ============================================================================
-- Hot path da story 5.5: buscar guias da execução concluída anterior do médico.
-- Parcial em medico_id not null (resultados órfãos de médico não entram na busca).
create index if not exists idx_execucao_resultados_medico
  on execucao_resultados (medico_id)
  where medico_id is not null;

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- ATENÇÃO: os restores de NOT NULL falham se já existirem linhas com NULL —
-- limpar/preencher antes (é o comportamento desejado: rollback consciente).
-- drop index if exists idx_execucao_resultados_medico;
-- alter table execucao_resultados alter column cpf set not null;
-- drop policy if exists execucao_selecoes_select on execucao_selecoes;
-- drop table if exists execucao_selecoes;
-- alter table medicos alter column cpf set not null;
-- drop index if exists uq_medicos_external_id;
-- alter table medicos drop column if exists external_id;
