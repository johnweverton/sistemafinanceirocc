-- Migration 0030 — cadastro de clientes contábeis (Story 11.1, Epic 11).
-- Base de dados para a carteira de honorários contábeis, separada por desenho da carteira de
-- agregação médica (`empresas`, Épico 10.4 — ver docs/architecture/feature-emissao-contabilidade.md,
-- decisão D1: tabela nova, não reaproveitar `empresas`, que é especificamente sobre agregação de
-- produção de médicos). Esta migration SÓ cria o cadastro — sem lançamento de faturamento (11.2),
-- execução ou emissão (11.3), boleto avulso semestral (11.4).
--
-- Reaproveita o mesmo desenho de colunas já usado em `empresas`/`medicos` para cobrança, condições
-- e regra de preço (migrations 0006/0025/0027/0028), mais os campos próprios deste domínio:
-- regime_tributario, modo_cobranca, os 2 valores da forma 'faixa_faturamento' e o bloco de
-- adicional semestral.

-- ============================================================================
-- 1. clientes_contabilidade
-- ============================================================================
create table if not exists clientes_contabilidade (
  id uuid primary key default gen_random_uuid(),
  nome text not null,

  regime_tributario text not null check (regime_tributario in ('simples_nacional', 'lucro_presumido')),
  modo_cobranca text not null check (modo_cobranca in ('faixa_faturamento', 'fixo')),

  -- Dados de cobrança (pagador PJ na prática, mesmo formato de medicos/empresas — migration 0006/0028).
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

  -- Overrides comerciais (vencimento/multa/juros/desconto) — mesmo formato de medicos/empresas.
  dias_vencimento integer,
  multa_percent numeric(5,2),
  juros_mes_percent numeric(5,2),
  desconto_percent numeric(5,2),
  desconto_dias integer,

  -- Regra de preço (Story 10.1/10.4b, forma 'faixa_faturamento' estendida na Story 11.1).
  regra_preco_forma text,
  regra_preco_base numeric(10,2),
  regra_preco_limiar numeric(10,2),
  regra_preco_taxa numeric(10,2),
  regra_preco_valor_fixo numeric(10,2),
  regra_preco_valor_abaixo_limiar numeric(10,2),
  regra_preco_valor_acima_limiar numeric(10,2),

  -- Adicional semestral avulso (ex.: Vital Soluções, R$15.000 a cada 6 meses — geração na Story 11.4).
  adicional_ativo boolean not null default false,
  adicional_valor numeric(10,2),
  adicional_intervalo_meses integer,
  adicional_competencia_base text, -- 'YYYY-MM'

  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CHECKs nomeadas com drop+add para idempotência em re-execução (padrão de 0018/0025/0027/0028 —
-- QA-104A-1: `create table if not exists` é no-op numa 2ª aplicação, mas `add constraint` sem o
-- drop prévio falharia com "constraint already exists").
alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_pagador_tipo;
alter table clientes_contabilidade add constraint chk_clientes_contabilidade_pagador_tipo
  check (pagador_tipo is null or pagador_tipo in ('PF', 'PJ'));

alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_conta_emissora;
alter table clientes_contabilidade add constraint chk_clientes_contabilidade_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana'));

alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_regra_preco_forma;
alter table clientes_contabilidade add constraint chk_clientes_contabilidade_regra_preco_forma
  check (regra_preco_forma is null or regra_preco_forma in ('por_guia', 'base_excedente', 'fixo', 'faixa_faturamento'));

-- Coerência por forma — mesmo padrão da 0028, mais a forma 'faixa_faturamento' (Story 11.1).
alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_regra_preco_coerente;
alter table clientes_contabilidade add constraint chk_clientes_contabilidade_regra_preco_coerente
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
    or (
      regra_preco_forma = 'faixa_faturamento'
      and regra_preco_limiar is not null
      and regra_preco_valor_abaixo_limiar is not null
      and regra_preco_valor_acima_limiar is not null
    )
  );

-- Adicional semestral: ativo exige valor + intervalo + competência base preenchidos.
alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_adicional_coerente;
alter table clientes_contabilidade add constraint chk_clientes_contabilidade_adicional_coerente
  check (
    adicional_ativo = false
    or (adicional_valor is not null and adicional_intervalo_meses is not null and adicional_competencia_base is not null)
  );

comment on table clientes_contabilidade is
  'Clientes do escritório de contabilidade (honorários mensais — Story 11.1, Epic 11). Domínio separado de empresas (Épico 10.4, agregação de produção médica) — ver docs/architecture/feature-emissao-contabilidade.md.';
comment on column clientes_contabilidade.modo_cobranca is
  'Decide a regra de cálculo do boleto mensal: faixa_faturamento (varia por faturamento informado, Story 11.2) ou fixo (valor de contrato, reajuste anual manual). Não é o regime_tributario que decide — há exceções fixas dentro do Simples Nacional.';
comment on column clientes_contabilidade.regra_preco_forma is
  'Forma da regra de preço: por_guia/base_excedente (não usadas neste domínio, mantidas por reuso do tipo compartilhado), fixo ou faixa_faturamento.';

create index if not exists idx_clientes_contabilidade_ativo on clientes_contabilidade (ativo) where ativo = true;

-- ============================================================================
-- 2. clientes_contabilidade_historico — auditoria (PRD §7, mesmo padrão de empresas_historico)
-- ============================================================================
create table if not exists clientes_contabilidade_historico (
  id uuid primary key default gen_random_uuid(),
  cliente_contabilidade_id uuid not null references clientes_contabilidade(id),
  campo_alterado text not null,
  valor_anterior text,
  valor_novo text,
  alterado_por uuid not null references profiles(id),
  motivo text,
  alterado_em timestamptz not null default now()
);

create index if not exists idx_clientes_contabilidade_historico_cliente
  on clientes_contabilidade_historico (cliente_contabilidade_id);

comment on table clientes_contabilidade_historico is
  'Histórico de alteração de cadastro de cliente contábil — requisito não-opcional (mesmo padrão de empresas_historico, PRD §7).';

-- ============================================================================
-- RLS — mesmo padrão de empresas/empresas_historico (migration 0028): has_profile() para
-- leitura, has_profile() + admin para escrita. Escrita real é via service role no repository
-- (bypassa RLS); as policies são defesa em profundidade.
-- ============================================================================
alter table clientes_contabilidade enable row level security;
alter table clientes_contabilidade_historico enable row level security;

drop policy if exists clientes_contabilidade_select on clientes_contabilidade;
create policy clientes_contabilidade_select on clientes_contabilidade for select using (has_profile());

drop policy if exists clientes_contabilidade_write_admin on clientes_contabilidade;
create policy clientes_contabilidade_write_admin on clientes_contabilidade for all using (
  has_profile()
  and auth.uid() in (select id from profiles where papel = 'admin')
);

drop policy if exists clientes_contabilidade_historico_select on clientes_contabilidade_historico;
create policy clientes_contabilidade_historico_select on clientes_contabilidade_historico for select using (has_profile());

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop policy if exists clientes_contabilidade_historico_select on clientes_contabilidade_historico;
-- drop policy if exists clientes_contabilidade_write_admin on clientes_contabilidade;
-- drop policy if exists clientes_contabilidade_select on clientes_contabilidade;
-- drop table if exists clientes_contabilidade_historico;
-- drop table if exists clientes_contabilidade;
