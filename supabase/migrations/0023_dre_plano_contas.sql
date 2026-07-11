-- Migration 0023 — DRE / Plano de Contas (Story 9.1, Épico 9).
-- Plano de contas cadastrável + regras de categorização + lançamentos manuais de despesa
-- fora da Cora + colunas de categoria em extrato_transacoes.
-- Fonte: docs/architecture/feature-dre-plano-contas.md §4 (aprovada pelo dono 2026-07-11).
--
-- Decisões refletidas aqui:
--   - D1: plano de contas é cadastro EDITÁVEL (não enum fixo em código). `grupo` é o único
--     enum fechado (dá a fórmula do DRE); `nome` é livre. 2 linhas nascem `sistema=true`
--     (protegidas — usadas pela auto-categorização da 9.2), as demais são seed comum.
--   - D2: categoria vive em `categoria_id`/`status_categorizacao` em extrato_transacoes
--     (eixo INDEPENDENTE de status_conciliacao — uma transação pode estar conciliada e
--     sem categoria ao mesmo tempo) + em dre_lancamentos_manuais (sempre exigida).
--   - D4: lançamento recorrente é um TEMPLATE (sem cron) — a expansão em instâncias
--     mensais acontece na leitura do relatório (9.2), não aqui.
--
-- Aditiva e idempotente: create table/index if not exists + CHECKs e policies com
-- drop/add nomeado (padrão 0018/0021/0022). RLS espelha extrato_transacoes: leitura
-- admin/financeiro, escrita só via service role (a rota decide admin-só vs
-- admin/financeiro para escrita — mesmo padrão de config_cobranca).

create table if not exists plano_contas (
  id uuid primary key default gen_random_uuid(),
  grupo text not null,
  nome text not null,
  sistema boolean not null default false,  -- true = seed protegido, nunca deletável (9.2)
  ativo boolean not null default true,     -- desativar em vez de deletar quando há uso
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);

alter table plano_contas drop constraint if exists chk_plano_contas_grupo;
alter table plano_contas add constraint chk_plano_contas_grupo
  check (grupo in ('receita', 'deducao_receita', 'despesa_operacional', 'despesa_financeira'));

alter table plano_contas drop constraint if exists uq_plano_contas_grupo_nome;
alter table plano_contas add constraint uq_plano_contas_grupo_nome unique (grupo, nome);

comment on table plano_contas is
  'Plano de contas do DRE (Épico 9, D1) — cadastro editável, não enum fixo em código. O grupo é fechado (dá a fórmula do DRE); o nome é livre.';
comment on column plano_contas.sistema is
  'true = categoria de sistema (seed protegido), usada pela auto-categorização da 9.2 (crédito conciliado -> Receita de honorários; débito FEE -> Tarifas bancárias). Nunca aceita DELETE nem troca de grupo/sistema.';
comment on column plano_contas.ativo is
  'false = desativada (soft-disable). DELETE físico só é permitido sem vínculos em uso — mesmo padrão de config_cobranca.';

-- ============================================================================
-- plano_contas_regras — categorização automática por palavra-chave (9.2 consome).
-- ============================================================================
create table if not exists plano_contas_regras (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references plano_contas(id),
  campo text not null,
  padrao text not null,                    -- substring, case-insensitive (ILIKE '%padrao%')
  prioridade integer not null default 0,   -- menor primeiro; primeira regra que bate vence
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table plano_contas_regras drop constraint if exists chk_plano_contas_regras_campo;
alter table plano_contas_regras add constraint chk_plano_contas_regras_campo
  check (campo in ('contraparte_nome', 'descricao'));

create index if not exists idx_plano_contas_regras_ativo_prioridade
  on plano_contas_regras (ativo, prioridade);

comment on table plano_contas_regras is
  'Regras de categorização automática por palavra-chave (Épico 9, D3) — sempre resulta em status_categorizacao=sugerida (nunca confirma sozinha, ao contrário das 2 auto-regras de sistema do motor).';

-- ============================================================================
-- dre_lancamentos_manuais — despesas fora da Cora (avulsas ou recorrentes).
-- ============================================================================
create table if not exists dre_lancamentos_manuais (
  id uuid primary key default gen_random_uuid(),
  conta_emissora text not null,
  categoria_id uuid not null references plano_contas(id),  -- sempre exigida (D2)
  descricao text not null,
  valor numeric(12,2) not null,
  tipo_lancamento text not null,
  data date,               -- obrigatório quando avulso
  dia_do_mes integer,      -- obrigatório quando recorrente (1-28: evita mês curto, D4)
  data_inicio date,        -- obrigatório quando recorrente
  data_fim date,           -- null = sem fim (recorrente ativo indefinidamente)
  criado_por uuid not null references profiles(id),
  criado_em timestamptz not null default now()
);

alter table dre_lancamentos_manuais drop constraint if exists chk_dre_lanc_conta_emissora;
alter table dre_lancamentos_manuais add constraint chk_dre_lanc_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana'));

alter table dre_lancamentos_manuais drop constraint if exists chk_dre_lanc_tipo;
alter table dre_lancamentos_manuais add constraint chk_dre_lanc_tipo
  check (tipo_lancamento in ('avulso', 'recorrente'));

alter table dre_lancamentos_manuais drop constraint if exists chk_dre_lanc_dia_do_mes;
alter table dre_lancamentos_manuais add constraint chk_dre_lanc_dia_do_mes
  check (dia_do_mes is null or dia_do_mes between 1 and 28);

-- Exatamente um dos dois conjuntos de campos preenchido, conforme tipo_lancamento
-- (arquitetura §4) — o repository (9.1) faz o mesmo check ANTES de bater no banco,
-- mas o CHECK é a garantia estrutural final.
alter table dre_lancamentos_manuais drop constraint if exists chk_dre_lanc_campos_por_tipo;
alter table dre_lancamentos_manuais add constraint chk_dre_lanc_campos_por_tipo
  check (
    (tipo_lancamento = 'avulso'
      and data is not null and dia_do_mes is null and data_inicio is null and data_fim is null)
    or
    (tipo_lancamento = 'recorrente'
      and data is null and dia_do_mes is not null and data_inicio is not null)
  );

create index if not exists idx_dre_lanc_conta_tipo
  on dre_lancamentos_manuais (conta_emissora, tipo_lancamento);

comment on table dre_lancamentos_manuais is
  'Lançamentos manuais de despesa fora da Cora (Épico 9, D2/D4) — avulso (data única) ou recorrente (template projetado NA LEITURA do relatório, sem cron; editar 1 mês isolado exige encerrar o template).';
comment on column dre_lancamentos_manuais.dia_do_mes is
  'Só para recorrente. Limitado a 1-28 para evitar mês curto (fevereiro) na expansão do relatório (9.2).';
comment on column dre_lancamentos_manuais.data_fim is
  'null = recorrência sem fim definido (ativa indefinidamente até o usuário encerrar).';

-- ============================================================================
-- extrato_transacoes — categoria (ALTER aditivo sobre a tabela do Épico 8, 0022).
-- ============================================================================
alter table extrato_transacoes add column if not exists categoria_id uuid references plano_contas(id);
alter table extrato_transacoes add column if not exists status_categorizacao text not null default 'sem_categoria';

alter table extrato_transacoes drop constraint if exists chk_extrato_status_categorizacao;
alter table extrato_transacoes add constraint chk_extrato_status_categorizacao
  check (status_categorizacao in ('sem_categoria', 'sugerida', 'confirmada'));

create index if not exists idx_extrato_status_categorizacao
  on extrato_transacoes (status_categorizacao);

comment on column extrato_transacoes.categoria_id is
  'Categoria do DRE (Épico 9) — eixo INDEPENDENTE de status_conciliacao: uma transação pode estar conciliada e sem categoria ao mesmo tempo.';
comment on column extrato_transacoes.status_categorizacao is
  'sem_categoria | sugerida (regra do usuário, exige confirmação) | confirmada (auto-regra de sistema ou confirmação humana).';

-- ============================================================================
-- Seed — categorias de sistema (protegidas) + proposta inicial do discovery
-- (docs/stories/README.md, Épico 9 §6). Idempotente via ON CONFLICT no UNIQUE (grupo, nome).
-- ============================================================================
insert into plano_contas (grupo, nome, sistema, ordem) values
  ('receita', 'Receita de honorários', true, 0),
  ('deducao_receita', 'Tarifas bancárias', true, 0),
  ('deducao_receita', 'Impostos sobre serviços', false, 1),
  ('despesa_operacional', 'Despesas administrativas', false, 0),
  ('despesa_operacional', 'Despesas com pessoal', false, 1),
  ('despesa_operacional', 'Despesas com terceiros', false, 2),
  ('despesa_financeira', 'Juros e outras taxas', false, 0)
on conflict (grupo, nome) do nothing;

-- ============================================================================
-- RLS — espelha extrato_transacoes (0022): leitura admin/financeiro; escrita só
-- service role. A diferenciação admin-só (plano_contas/regras) vs admin/financeiro
-- (dre_lancamentos_manuais, categorizar) para ESCRITA é responsabilidade da rota (9.2).
-- ============================================================================
alter table plano_contas enable row level security;

drop policy if exists "Leitura de plano de contas para admin e financeiro" on plano_contas;
create policy "Leitura de plano de contas para admin e financeiro"
  on plano_contas for select
  using (
    auth.uid() in (
      select id from profiles where papel in ('admin', 'financeiro')
    )
  );

alter table plano_contas_regras enable row level security;

drop policy if exists "Leitura de regras de categorizacao para admin e financeiro" on plano_contas_regras;
create policy "Leitura de regras de categorizacao para admin e financeiro"
  on plano_contas_regras for select
  using (
    auth.uid() in (
      select id from profiles where papel in ('admin', 'financeiro')
    )
  );

alter table dre_lancamentos_manuais enable row level security;

drop policy if exists "Leitura de lancamentos manuais para admin e financeiro" on dre_lancamentos_manuais;
create policy "Leitura de lancamentos manuais para admin e financeiro"
  on dre_lancamentos_manuais for select
  using (
    auth.uid() in (
      select id from profiles where papel in ('admin', 'financeiro')
    )
  );

-- Insert/update/delete só via service role (server-side) — sem policy de escrita para clientes.

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop policy if exists "Leitura de lancamentos manuais para admin e financeiro" on dre_lancamentos_manuais;
-- drop policy if exists "Leitura de regras de categorizacao para admin e financeiro" on plano_contas_regras;
-- drop policy if exists "Leitura de plano de contas para admin e financeiro" on plano_contas;
-- drop index if exists idx_extrato_status_categorizacao;
-- alter table extrato_transacoes drop constraint if exists chk_extrato_status_categorizacao;
-- alter table extrato_transacoes drop column if exists status_categorizacao;
-- alter table extrato_transacoes drop column if exists categoria_id;
-- drop table if exists dre_lancamentos_manuais;
-- drop table if exists plano_contas_regras;
-- drop table if exists plano_contas;
