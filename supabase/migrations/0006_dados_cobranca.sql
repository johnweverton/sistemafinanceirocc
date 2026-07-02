-- Migration 0006 — dados de cobrança do pagador + condições comerciais (Fase 3).
-- Fonte: docs/architecture/feature-dados-cobranca-boleto.md.
-- Objetivo: habilitar a emissão de boletos Cora, que exige dados completos do pagador
-- (nome, documento CPF/CNPJ, e-mail e endereço) + condições comerciais parametrizáveis
-- (vencimento, multa, juros, desconto).
--
-- Segurança: tudo ADITIVO e NULLABLE (zero downtime). A completude dos dados de cobrança
-- é exigida na emissão (guard 422 na rota), não no cadastro — preserva o fluxo de
-- auto-descoberta (médico entra sem cobrança e é completado depois).
--
-- Idempotente: seguro para rodar mais de uma vez (if not exists / guards / on conflict).

-- ============================================================================
-- 1. medicos — bloco de cobrança do pagador (todas nullable)
-- ============================================================================
-- Observação de domínio: medicos.cpf continua sendo a CHAVE de cruzamento com a API
-- da Carmem e NÃO muda. pagador_documento é independente (pode ser o CNPJ da PJ do médico).
alter table medicos
  add column if not exists pagador_tipo      text,
  add column if not exists pagador_documento text,
  add column if not exists pagador_nome      text,
  add column if not exists email             text,
  add column if not exists cep               text,
  add column if not exists logradouro        text,
  add column if not exists numero            text,
  add column if not exists complemento       text,
  add column if not exists bairro            text,
  add column if not exists cidade            text,
  add column if not exists uf                char(2);

-- ============================================================================
-- 2. medicos — overrides comerciais (nullable; null = herda config_cobranca global)
-- ============================================================================
alter table medicos
  add column if not exists dias_vencimento    integer,
  add column if not exists multa_percent      numeric(5,2),
  add column if not exists juros_mes_percent  numeric(5,2),
  add column if not exists desconto_percent   numeric(5,2),
  add column if not exists desconto_dias      integer;

-- ============================================================================
-- 3. Constraints de validação (só validam quando o campo está preenchido)
-- ============================================================================
-- Cada constraint é adicionada via guard (add constraint não tem "if not exists").
do $$
begin
  -- pagador_tipo ∈ {PF, PJ}
  if not exists (select 1 from pg_constraint where conname = 'medicos_pagador_tipo_valido') then
    alter table medicos add constraint medicos_pagador_tipo_valido
      check (pagador_tipo is null or pagador_tipo in ('PF','PJ'));
  end if;

  -- documento coerente com o tipo: PF=11 dígitos, PJ=14 (valida só quando ambos presentes)
  if not exists (select 1 from pg_constraint where conname = 'medicos_pagador_documento_valido') then
    alter table medicos add constraint medicos_pagador_documento_valido
      check (
        pagador_tipo is null
        or pagador_documento is null
        or (pagador_tipo = 'PF' and pagador_documento ~ '^\d{11}$')
        or (pagador_tipo = 'PJ' and pagador_documento ~ '^\d{14}$')
      );
  end if;

  -- e-mail em formato básico
  if not exists (select 1 from pg_constraint where conname = 'medicos_email_valido') then
    alter table medicos add constraint medicos_email_valido
      check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
  end if;

  -- CEP = 8 dígitos
  if not exists (select 1 from pg_constraint where conname = 'medicos_cep_valido') then
    alter table medicos add constraint medicos_cep_valido
      check (cep is null or cep ~ '^\d{8}$');
  end if;

  -- UF válida (27 unidades federativas)
  if not exists (select 1 from pg_constraint where conname = 'medicos_uf_valida') then
    alter table medicos add constraint medicos_uf_valida
      check (uf is null or uf in (
        'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
        'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
      ));
  end if;

  -- overrides comerciais em faixas sãs
  if not exists (select 1 from pg_constraint where conname = 'medicos_condicoes_validas') then
    alter table medicos add constraint medicos_condicoes_validas
      check (
        (dias_vencimento   is null or dias_vencimento   between 0 and 365)
        and (multa_percent     is null or multa_percent     between 0 and 100)
        and (juros_mes_percent is null or juros_mes_percent between 0 and 100)
        and (desconto_percent  is null or desconto_percent  between 0 and 100)
        and (desconto_dias     is null or desconto_dias     between 0 and 365)
      );
  end if;
end $$;

-- ============================================================================
-- 4. config_cobranca — defaults globais do escritório (singleton)
-- ============================================================================
create table if not exists config_cobranca (
  id                integer primary key default 1 check (id = 1), -- garante linha única
  dias_vencimento   integer not null default 30 check (dias_vencimento between 0 and 365),
  multa_percent     numeric(5,2) check (multa_percent     is null or multa_percent     between 0 and 100),
  juros_mes_percent numeric(5,2) check (juros_mes_percent is null or juros_mes_percent between 0 and 100),
  desconto_percent  numeric(5,2) check (desconto_percent  is null or desconto_percent  between 0 and 100),
  desconto_dias     integer      check (desconto_dias     is null or desconto_dias     between 0 and 365),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Seed idempotente: 1 linha default (vencimento 30 dias, sem multa/juros/desconto).
insert into config_cobranca (id, dias_vencimento)
values (1, 30)
on conflict (id) do nothing;

-- ============================================================================
-- 5. RLS de config_cobranca (espelha 0002_rls_policies.sql: leitura autenticada, escrita admin)
-- ============================================================================
alter table config_cobranca enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'config_cobranca' and policyname = 'config_cobranca_select'
  ) then
    create policy config_cobranca_select on config_cobranca
      for select using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'config_cobranca' and policyname = 'config_cobranca_write_admin'
  ) then
    create policy config_cobranca_write_admin on config_cobranca
      for all
      using      (exists (select 1 from profiles where id = auth.uid() and papel = 'admin'))
      with check (exists (select 1 from profiles where id = auth.uid() and papel = 'admin'));
  end if;
end $$;

-- ============================================================================
-- 6. Documentação embutida
-- ============================================================================
comment on column medicos.pagador_documento is 'CPF (11) ou CNPJ (14) do pagador do boleto; independente de medicos.cpf (chave Carmem).';
comment on column medicos.dias_vencimento   is 'Override do vencimento; null herda config_cobranca.dias_vencimento.';
comment on table  config_cobranca           is 'Defaults comerciais do escritório (singleton, id=1): vencimento, multa, juros, desconto.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop table if exists config_cobranca;
-- alter table medicos
--   drop constraint if exists medicos_pagador_tipo_valido,
--   drop constraint if exists medicos_pagador_documento_valido,
--   drop constraint if exists medicos_email_valido,
--   drop constraint if exists medicos_cep_valido,
--   drop constraint if exists medicos_uf_valida,
--   drop constraint if exists medicos_condicoes_validas,
--   drop column if exists pagador_tipo, drop column if exists pagador_documento,
--   drop column if exists pagador_nome, drop column if exists email,
--   drop column if exists cep, drop column if exists logradouro, drop column if exists numero,
--   drop column if exists complemento, drop column if exists bairro, drop column if exists cidade,
--   drop column if exists uf,
--   drop column if exists dias_vencimento, drop column if exists multa_percent,
--   drop column if exists juros_mes_percent, drop column if exists desconto_percent,
--   drop column if exists desconto_dias;
