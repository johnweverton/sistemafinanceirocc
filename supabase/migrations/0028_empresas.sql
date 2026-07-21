-- Migration 0028 — cadastro de empresas (Story 10.4a, Épico 10).
-- Base de dados para agrupar produção de vários médicos numa única empresa emissora
-- (ex.: MEDISA — ver docs/stories/10.4.emissao-por-empresa-medisa.story.md para o desenho
-- completo do @architect). Esta migration SÓ cria o cadastro — nenhuma execução ainda
-- (Story 10.4b) nem emissão (Story 10.4c).
--
-- Reaproveita literalmente o mesmo desenho de colunas já usado em `medicos` para cobrança
-- (migration 0006), regra de preço própria (migrations 0025/0027) e conta emissora
-- (migration 0021) — mesma forma, mesmas CHECKs, só que numa tabela nova. Isso é DELIBERADO:
-- a empresa usa os mesmos tipos de domínio do médico (DadosCobranca, RegraPreco, ContaEmissora),
-- não uma variação.
--
-- `medicos.empresa_grupo_id` é o vínculo — nullable, backfill null (nenhum médico existente
-- muda de comportamento). É ORTOGONAL a `medicos.conta_emissora` (Épico 7): aquela é "de qual
-- conta Cora sai o boleto individual deste médico"; esta é "este médico tem produção que é
-- agregada e faturada para uma empresa". Não confundir as duas colunas.

-- ============================================================================
-- 1. empresas
-- ============================================================================
create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,

  -- Dados de cobrança (pagador PJ na prática, mesmo formato de medicos — migration 0006).
  pagador_tipo text,
  pagador_documento text,
  pagador_nome text,
  email text,
  whatsapp text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,

  -- Conta emissora (Cora) — mesmo domínio do Épico 7.
  conta_emissora text not null default 'mc',

  -- Overrides comerciais (vencimento/multa/juros/desconto) — mesmo formato de medicos (0006).
  dias_vencimento integer,
  multa_percent numeric(5,2),
  juros_mes_percent numeric(5,2),
  desconto_percent numeric(5,2),
  desconto_dias integer,

  -- Regra de preço própria — mesmo domínio da Story 10.1 (migrations 0025/0027). Para empresa,
  -- é SEMPRE a regra usada na agregação (não existe "modo_cobranca" — empresa não tem faixas).
  regra_preco_forma text,
  regra_preco_base numeric(10,2),
  regra_preco_limiar integer,
  regra_preco_taxa numeric(10,2),
  regra_preco_valor_fixo numeric(10,2),

  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CHECKs nomeadas com drop+add para idempotência em re-execução (mesmo padrão de 0018/0025/0027) —
-- `create table if not exists` faz no-op se a tabela já existe, mas `add constraint` sem o drop
-- prévio falharia com "constraint already exists" numa segunda aplicação da migration.
alter table empresas drop constraint if exists chk_empresas_pagador_tipo;
alter table empresas add constraint chk_empresas_pagador_tipo
  check (pagador_tipo is null or pagador_tipo in ('PF', 'PJ'));

alter table empresas drop constraint if exists chk_empresas_conta_emissora;
alter table empresas add constraint chk_empresas_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana'));

alter table empresas drop constraint if exists chk_empresas_regra_preco_forma;
alter table empresas add constraint chk_empresas_regra_preco_forma
  check (regra_preco_forma is null or regra_preco_forma in ('por_guia', 'base_excedente', 'fixo'));

-- Coerência por forma — mesma regra da 0027, mas SEM o gate de modo_cobranca (empresa não tem
-- faixa_guias/percentual_producao; se a forma está setada, os campos dela são obrigatórios).
alter table empresas drop constraint if exists chk_empresas_regra_preco_coerente;
alter table empresas add constraint chk_empresas_regra_preco_coerente
  check (
    regra_preco_forma is null
    or (regra_preco_forma = 'por_guia' and regra_preco_taxa is not null)
    or (
      regra_preco_forma = 'base_excedente'
      and regra_preco_base is not null
      and regra_preco_limiar is not null
      and regra_preco_taxa is not null
    )
    or (regra_preco_forma = 'fixo' and regra_preco_valor_fixo is not null)
  );

comment on table empresas is
  'Empresas que agregam produção de vários médicos num boleto único (Story 10.4, Épico 10) — ex.: MEDISA (guias cardíacas). Reaproveita os mesmos tipos de médico (cobrança, regra de preço, conta emissora).';
comment on column empresas.regra_preco_forma is
  'Forma da regra de preço da empresa (Story 10.4b): por_guia, base_excedente ou fixo. MVP da agregação (10.4b) só suporta por_guia — as demais formas geram alerta na execução, nunca um rateio chutado.';

create index if not exists idx_empresas_ativo on empresas (ativo) where ativo = true;

-- ============================================================================
-- 2. empresas_historico — auditoria (PRD §7, mesmo padrão de medicos_historico)
-- ============================================================================
create table if not exists empresas_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  campo_alterado text not null,
  valor_anterior text,
  valor_novo text,
  alterado_por uuid not null references profiles(id),
  motivo text,
  alterado_em timestamptz not null default now()
);

create index if not exists idx_empresas_historico_empresa on empresas_historico (empresa_id);

comment on table empresas_historico is
  'Histórico de alteração de cadastro de empresa — requisito não-opcional (mesmo padrão de medicos_historico, PRD §7).';

-- ============================================================================
-- 3. medicos.empresa_grupo_id — vínculo médico → empresa (Story 10.4a)
-- ============================================================================
alter table medicos
  add column if not exists empresa_grupo_id uuid references empresas(id);

comment on column medicos.empresa_grupo_id is
  'Empresa para a qual a produção de guias cardíacas (ou análoga) deste médico é agregada (Story 10.4). NULL = médico sem vínculo, produção 100% individual (comportamento atual). Ortogonal a conta_emissora (Épico 7): aquela é o banco do boleto INDIVIDUAL deste médico; esta é o agrupamento multi-médico de uma produção específica.';

create index if not exists idx_medicos_empresa_grupo on medicos (empresa_grupo_id) where empresa_grupo_id is not null;

-- ============================================================================
-- RLS — mesmo padrão de medicos/medicos_historico (migration 0015): has_profile() para
-- leitura, has_profile() + admin para escrita. Escrita real é via service role no repository
-- (bypassa RLS); as policies são defesa em profundidade.
-- ============================================================================
alter table empresas enable row level security;
alter table empresas_historico enable row level security;

drop policy if exists empresas_select on empresas;
create policy empresas_select on empresas for select using (has_profile());

drop policy if exists empresas_write_admin on empresas;
create policy empresas_write_admin on empresas for all using (
  has_profile()
  and auth.uid() in (select id from profiles where papel = 'admin')
);

drop policy if exists empresas_historico_select on empresas_historico;
create policy empresas_historico_select on empresas_historico for select using (has_profile());

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop policy if exists empresas_historico_select on empresas_historico;
-- drop policy if exists empresas_write_admin on empresas;
-- drop policy if exists empresas_select on empresas;
-- alter table medicos drop column if exists empresa_grupo_id;
-- drop table if exists empresas_historico;
-- drop table if exists empresas;
