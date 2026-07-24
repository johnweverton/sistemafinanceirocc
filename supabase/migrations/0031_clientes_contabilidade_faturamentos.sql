-- Migration 0031 — histórico de faturamento mensal dos clientes contábeis (Story 11.2, Epic 11).
-- Depende da 11.1 (tabela `clientes_contabilidade`). Usado pelo modo `faixa_faturamento`: o
-- operador informa o faturamento do mês e o valor do boleto é calculado por `aplicarRegraPreco`
-- (Engine, Story 11.2) — < limiar → valor_abaixo_limiar; >= limiar → valor_acima_limiar.

create table if not exists clientes_contabilidade_faturamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_contabilidade_id uuid not null references clientes_contabilidade(id),
  competencia text not null, -- 'YYYY-MM'
  faturamento numeric(12,2) not null,
  informado_por uuid not null references profiles(id),
  informado_em timestamptz not null default now()
);

-- Um lançamento por competência — relançar ATUALIZA (upsert no repository), não duplica.
alter table clientes_contabilidade_faturamentos drop constraint if exists uq_clientes_contabilidade_faturamentos_cliente_competencia;
alter table clientes_contabilidade_faturamentos add constraint uq_clientes_contabilidade_faturamentos_cliente_competencia
  unique (cliente_contabilidade_id, competencia);

alter table clientes_contabilidade_faturamentos drop constraint if exists chk_clientes_contabilidade_faturamentos_competencia;
alter table clientes_contabilidade_faturamentos add constraint chk_clientes_contabilidade_faturamentos_competencia
  check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

alter table clientes_contabilidade_faturamentos drop constraint if exists chk_clientes_contabilidade_faturamentos_valor;
alter table clientes_contabilidade_faturamentos add constraint chk_clientes_contabilidade_faturamentos_valor
  check (faturamento >= 0);

create index if not exists idx_clientes_contabilidade_faturamentos_cliente
  on clientes_contabilidade_faturamentos (cliente_contabilidade_id, competencia desc);

comment on table clientes_contabilidade_faturamentos is
  'Faturamento mensal informado por cliente contábil (modo faixa_faturamento — Story 11.2, Epic 11). Base do cálculo de aplicarRegraPreco (Engine).';

-- ============================================================================
-- RLS — mesmo padrão de clientes_contabilidade (migration 0030): leitura autenticada; escrita de
-- lançamento mensal NÃO exige admin (é operação de rotina, não alteração de cadastro) — qualquer
-- perfil com acesso ao sistema pode lançar, mas via service role no repository (RLS é defesa em
-- profundidade, igual ao padrão já usado).
-- ============================================================================
alter table clientes_contabilidade_faturamentos enable row level security;

drop policy if exists clientes_contabilidade_faturamentos_select on clientes_contabilidade_faturamentos;
create policy clientes_contabilidade_faturamentos_select on clientes_contabilidade_faturamentos
  for select using (has_profile());

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop policy if exists clientes_contabilidade_faturamentos_select on clientes_contabilidade_faturamentos;
-- drop table if exists clientes_contabilidade_faturamentos;
