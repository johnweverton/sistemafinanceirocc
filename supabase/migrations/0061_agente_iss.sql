-- Migration 0061 — agente de captura de faturamento no ISS Fortaleza (Story 13.1, Épico 13).
-- Arquitetura: docs/architecture/feature-agente-faturamento-iss.md.
--
-- O agente (CLI local, Story 13.2) lê o "Somatório de Serviços Prestados" da escrituração de cada
-- cliente `faixa_faturamento` e grava aqui como PROPOSTA (decisão G3 do dono). O lançamento
-- oficial continua em `clientes_contabilidade_faturamentos`, feito pelo operador no diálogo de
-- lote — que ganha só `origem`/`iss_captura_id` para a trilha dizer de onde veio o número.

-- ============================================================================
-- 1. Execuções do agente (uma por rodada do CLI)
-- ============================================================================
create table if not exists iss_execucoes_agente (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,
  iniciado_em timestamptz not null,
  finalizado_em timestamptz,
  maquina text,
  versao_agente text,
  totais jsonb not null default '{}'::jsonb,   -- {capturado, nao_encontrado, sem_escrituracao, erro}
  ciencias jsonb not null default '[]'::jsonb, -- comunicados em que o agente deu ciência (G2)
  created_at timestamptz not null default now()
);

alter table iss_execucoes_agente drop constraint if exists chk_iss_execucoes_agente_competencia;
alter table iss_execucoes_agente add constraint chk_iss_execucoes_agente_competencia
  check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

create index if not exists idx_iss_execucoes_agente_competencia
  on iss_execucoes_agente (competencia, iniciado_em desc);

-- ============================================================================
-- 2. Capturas (append-only; proposta vigente = mais recente por cliente+competência)
-- ============================================================================
create table if not exists iss_capturas (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references iss_execucoes_agente(id) on delete cascade,
  cliente_contabilidade_id uuid not null references clientes_contabilidade(id),
  competencia text not null,
  status text not null,
  valor_servicos_prestados numeric(12,2),
  quantidade_notas integer,
  situacao_iss text,              -- ex.: 'Fechada - Retificadora(1)', 'Aberta - Normal'
  competencia_fechada boolean,
  inscricao_municipal text,
  razao_social_iss text,
  alertas text[] not null default '{}',
  mensagem_erro text,
  capturado_em timestamptz not null default now()
);

alter table iss_capturas drop constraint if exists chk_iss_capturas_status;
alter table iss_capturas add constraint chk_iss_capturas_status
  check (status in ('capturado', 'nao_encontrado', 'sem_escrituracao', 'erro'));

alter table iss_capturas drop constraint if exists chk_iss_capturas_competencia;
alter table iss_capturas add constraint chk_iss_capturas_competencia
  check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Capturado ⇒ tem valor e ele é não-negativo.
alter table iss_capturas drop constraint if exists chk_iss_capturas_valor;
alter table iss_capturas add constraint chk_iss_capturas_valor
  check (status <> 'capturado' or (valor_servicos_prestados is not null and valor_servicos_prestados >= 0));

create index if not exists idx_iss_capturas_cliente_comp
  on iss_capturas (cliente_contabilidade_id, competencia, capturado_em desc);
create index if not exists idx_iss_capturas_competencia
  on iss_capturas (competencia, capturado_em desc);

-- ============================================================================
-- 3. Trilha de origem no lançamento oficial
-- ============================================================================
alter table clientes_contabilidade_faturamentos
  add column if not exists origem text not null default 'manual';
alter table clientes_contabilidade_faturamentos
  add column if not exists iss_captura_id uuid references iss_capturas(id);

alter table clientes_contabilidade_faturamentos drop constraint if exists chk_clientes_contabilidade_faturamentos_origem;
alter table clientes_contabilidade_faturamentos add constraint chk_clientes_contabilidade_faturamentos_origem
  check (origem in ('manual', 'iss_fortaleza'));

comment on table iss_execucoes_agente is
  'Rodadas do agente local de captura de faturamento no ISS Fortaleza (Story 13.1, Épico 13).';
comment on table iss_capturas is
  'Faturamento lido do ISS por cliente/competência — PROPOSTA para conferência, não lançamento oficial (Story 13.1).';

-- ============================================================================
-- RLS — leitura para qualquer perfil; escrita só via service role nas rotas do agente
-- (mesmo padrão da 0031).
-- ============================================================================
alter table iss_execucoes_agente enable row level security;
alter table iss_capturas enable row level security;

drop policy if exists iss_execucoes_agente_select on iss_execucoes_agente;
create policy iss_execucoes_agente_select on iss_execucoes_agente
  for select using (has_profile());

drop policy if exists iss_capturas_select on iss_capturas;
create policy iss_capturas_select on iss_capturas
  for select using (has_profile());

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table clientes_contabilidade_faturamentos drop constraint if exists chk_clientes_contabilidade_faturamentos_origem;
-- alter table clientes_contabilidade_faturamentos drop column if exists iss_captura_id;
-- alter table clientes_contabilidade_faturamentos drop column if exists origem;
-- drop policy if exists iss_capturas_select on iss_capturas;
-- drop policy if exists iss_execucoes_agente_select on iss_execucoes_agente;
-- drop table if exists iss_capturas;
-- drop table if exists iss_execucoes_agente;
