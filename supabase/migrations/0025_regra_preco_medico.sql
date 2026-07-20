-- Migration 0025 — regra de preço própria por médico (Story 10.1, Épico 10).
-- Médicos com preço negociado FORA da tabela de faixas (PRD §5.1): Dr. Jansen (base +
-- excedente com limiar próprio), Dr. Nelson / Dr. Carlos Batista / Dr. Jefferson (valor fixo
-- mensal). Lista fechada pelo dono na GATE de negócio (2026-07-20) — ver Change Log da story.
--
-- Nefrologia/"guias cardíacas" (MEDISA) NÃO entram aqui: não são override de médico
-- individual, são produção de vários médicos agrupada e faturada para uma empresa —
-- tratado na Story 10.4 (emissão por empresa), fora do escopo desta migration.
--
-- Modo 'preco_proprio' é adicionado ao union de modo_cobranca (mesmo padrão da 0018, que
-- introduziu 'percentual_producao'). Mutuamente exclusivo com 'percentual_producao' porque
-- modo_cobranca é uma coluna única — um médico só pode estar em um modo por vez.
--
-- Backfill: nenhum médico existente ganha override (modo_cobranca continua 'faixa_guias' e as
-- colunas regra_preco_* ficam null). Idempotente: add column if not exists + CHECKs nomeadas
-- com drop+add (padrão 0018). Rollback no rodapé.

alter table medicos
  add column if not exists regra_preco_forma text,
  add column if not exists regra_preco_base numeric(10,2),
  add column if not exists regra_preco_limiar integer,
  add column if not exists regra_preco_taxa numeric(10,2),
  add column if not exists regra_preco_valor_fixo numeric(10,2);

-- modo_cobranca ganha o valor 'preco_proprio' (substitui a CHECK da 0018).
alter table medicos drop constraint if exists chk_medicos_modo_cobranca;
alter table medicos add constraint chk_medicos_modo_cobranca
  check (modo_cobranca in ('faixa_guias', 'percentual_producao', 'preco_proprio'));

alter table medicos drop constraint if exists chk_medicos_regra_preco_forma;
alter table medicos add constraint chk_medicos_regra_preco_forma
  check (regra_preco_forma is null or regra_preco_forma in ('base_excedente', 'fixo'));

-- Espelha a coerência exigida pelo Zod (medico-schema.ts): modo preco_proprio exige a forma e
-- os campos correspondentes preenchidos; base_excedente exige base+limiar+taxa, fixo exige
-- valor_fixo.
alter table medicos drop constraint if exists chk_medicos_regra_preco_coerente;
alter table medicos add constraint chk_medicos_regra_preco_coerente
  check (
    modo_cobranca <> 'preco_proprio'
    or (
      regra_preco_forma = 'base_excedente'
      and regra_preco_base is not null
      and regra_preco_limiar is not null
      and regra_preco_taxa is not null
    )
    or (
      regra_preco_forma = 'fixo'
      and regra_preco_valor_fixo is not null
    )
  );

comment on column medicos.regra_preco_forma is
  'Forma da regra de preço própria (Story 10.1): base_excedente ou fixo. Null = sem override (segue faixa_guias/percentual_producao).';
comment on column medicos.regra_preco_base is
  'Valor base antes do excedente (forma base_excedente). Ex.: Dr. Jansen ~935,62.';
comment on column medicos.regra_preco_limiar is
  'Guias a partir das quais o excedente por guia incide (forma base_excedente). Ex.: Dr. Jansen 144.';
comment on column medicos.regra_preco_taxa is
  'Valor por guia acima do limiar (forma base_excedente). Ex.: Dr. Jansen 6,50.';
comment on column medicos.regra_preco_valor_fixo is
  'Valor fixo mensal, independe de guias (forma fixo). Ex.: Nelson/Carlos Batista 591,22; Jefferson 130,53.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table medicos drop constraint if exists chk_medicos_regra_preco_coerente;
-- alter table medicos drop constraint if exists chk_medicos_regra_preco_forma;
-- alter table medicos drop constraint if exists chk_medicos_modo_cobranca;
-- alter table medicos add constraint chk_medicos_modo_cobranca
--   check (modo_cobranca in ('faixa_guias', 'percentual_producao'));
-- alter table medicos
--   drop column if exists regra_preco_forma,
--   drop column if exists regra_preco_base,
--   drop column if exists regra_preco_limiar,
--   drop column if exists regra_preco_taxa,
--   drop column if exists regra_preco_valor_fixo;
