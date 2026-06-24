-- Migration 0001 — schema inicial (Fase 1).
-- Fonte: docs/architecture.md (Database Schema) + PRD §7.
-- Tabelas: profiles, medicos, medicos_historico, precos, execucoes, execucao_resultados.

-- Perfis de usuário (papel), complementa o Supabase Auth (PRD §7, §8.1).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  papel text not null check (papel in ('admin','colaborador','financeiro')),
  colaborador_responsavel text,
  created_at timestamptz not null default now()
);

-- Cadastro de médicos — fonte única de verdade dos parâmetros (PRD §5.1, §7).
create table medicos (
  id uuid primary key default gen_random_uuid(),
  cpf text unique not null,
  nome text not null,
  especialidade text,
  status_hapvida text not null check (status_hapvida in ('credenciado','nao_credenciado','nenhum')),
  faz_outros_hospitais boolean not null default false,
  faz_imobilizacoes boolean not null default false,
  modo_mudanca_data text not null check (modo_mudanca_data in ('sim','nao')) default 'nao',
  colaborador_responsavel text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- combinação inválida: nenhum status Hapvida e sem outros hospitais (PRD §5.1, §8.2)
  constraint combinacao_classe_valida check (
    not (status_hapvida = 'nenhum' and faz_outros_hospitais = false)
  )
);

-- Histórico de alteração de configuração — requisito não-opcional (PRD §7).
create table medicos_historico (
  id uuid primary key default gen_random_uuid(),
  medico_id uuid not null references medicos(id),
  campo_alterado text not null,
  valor_anterior text,
  valor_novo text,
  alterado_por uuid not null references profiles(id),
  motivo text,
  alterado_em timestamptz not null default now()
);

-- Tabela de preços editável sem deploy (PRD §5.1).
create table precos (
  id uuid primary key default gen_random_uuid(),
  classe text not null check (classe in ('HAPVIDA_CRED','HAPVIDA_NAO_CRED','OUTROS_HOSPITAIS','IMOBILIZACOES')),
  teto_guias integer,           -- null = faixa "acima" / excedente
  valor numeric(10,2) not null,
  regra_excedente text,         -- ex.: 'por_guia:6.00' ou 'fixo'
  ordem integer not null
);

-- Execução de uma competência (PRD §6.3, §7).
create table execucoes (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,
  iniciado_por uuid not null references profiles(id),
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  status text not null check (status in ('processando','concluido','erro')) default 'processando',
  progresso integer not null default 0,
  total_medicos integer,
  total_ok integer,
  total_alerta integer,
  total_sem_dados integer,
  total_geral_valor numeric(12,2)
);

-- Resultado agregado por médico dentro de uma execução (PRD §7, §9).
create table execucao_resultados (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references execucoes(id),
  medico_id uuid references medicos(id),
  cpf text not null,
  nome text not null,
  procedimentos integer,
  cirurgias integer,
  guias integer,
  guias_consolidado integer,
  subtotais jsonb,
  total_valor numeric(10,2),
  status text not null check (status in ('ok','alerta','sem_dados')),
  alertas jsonb
);

create index idx_medicos_ativo on medicos (ativo) where ativo = true;
create index idx_execucao_resultados_execucao on execucao_resultados (execucao_id);
create index idx_medicos_historico_medico on medicos_historico (medico_id);
