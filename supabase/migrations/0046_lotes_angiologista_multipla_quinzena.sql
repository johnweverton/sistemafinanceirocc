-- Migration 0046 — Cateter/Fístula/Angiografia do Angiologista passam a aceitar MÚLTIPLOS
-- sub-lotes por categoria (achado real 2026-08-13: cada categoria vem dividida em "1Q"/"2Q"
-- no painel de origem — ex.: "SAMANTA CETETER 1Q" e "SAMANTA CETETER 2Q" — e as duas quinzenas
-- precisam ser somadas na mesma execução, não escolhidas uma-ou-outra).
--
-- Antes (migration 0044): 1 sub-lote por categoria (`producao_cateter_externa_id text`).
-- Agora: N sub-lotes por categoria (`producao_cateter_externa_ids text[]`) — cobre 1Q+2Q hoje e
-- qualquer outra divisão (3Q etc.) sem mudança de schema de novo. Carta de Rede (migration 0045)
-- NÃO muda: só tem 1 sub-lote de referência no painel de origem, sem divisão por quinzena, e não
-- alimenta cálculo (é contagem manual).
--
-- Backfill: nenhuma execução real usou os campos singulares até agora (a integração com a origem
-- só começou a funcionar em 2026-08-13 — ver commits desta mesma data). Mesmo assim, o backfill
-- abaixo é seguro/idempotente para o caso de já existir alguma linha de teste.

alter table execucao_selecoes
  add column if not exists producao_cateter_externa_ids text[],
  add column if not exists producao_cateter_nomes text[],
  add column if not exists producao_fistula_externa_ids text[],
  add column if not exists producao_fistula_nomes text[],
  add column if not exists producao_angiografia_externa_ids text[],
  add column if not exists producao_angiografia_nomes text[];

update execucao_selecoes
  set producao_cateter_externa_ids = array[producao_cateter_externa_id]
  where producao_cateter_externa_id is not null and producao_cateter_externa_ids is null;
update execucao_selecoes
  set producao_cateter_nomes = array[producao_cateter_nome]
  where producao_cateter_nome is not null and producao_cateter_nomes is null;
update execucao_selecoes
  set producao_fistula_externa_ids = array[producao_fistula_externa_id]
  where producao_fistula_externa_id is not null and producao_fistula_externa_ids is null;
update execucao_selecoes
  set producao_fistula_nomes = array[producao_fistula_nome]
  where producao_fistula_nome is not null and producao_fistula_nomes is null;
update execucao_selecoes
  set producao_angiografia_externa_ids = array[producao_angiografia_externa_id]
  where producao_angiografia_externa_id is not null and producao_angiografia_externa_ids is null;
update execucao_selecoes
  set producao_angiografia_nomes = array[producao_angiografia_nome]
  where producao_angiografia_nome is not null and producao_angiografia_nomes is null;

alter table execucao_selecoes
  drop column if exists producao_cateter_externa_id,
  drop column if exists producao_cateter_nome,
  drop column if exists producao_fistula_externa_id,
  drop column if exists producao_fistula_nome,
  drop column if exists producao_angiografia_externa_id,
  drop column if exists producao_angiografia_nome;

comment on column execucao_selecoes.producao_cateter_externa_ids is
  'Ids de SUB-LOTE (fin-lotes.id — GATE 2026-08-13) com as guias de CATETER do médico Angiologista, geralmente 1 por quinzena (1Q/2Q) — TODOS somados antes de contar 1x1. Busca de itens usa loteId por cada id do array, nunca producaoId. Array vazio/null = nenhum lote selecionado nesta execução — o motor gera alerta e NÃO cobra (nunca reaproveita outro lote).';
comment on column execucao_selecoes.producao_cateter_nomes is
  'Snapshot dos nomes dos sub-lotes de cateter exibidos na escolha, na mesma ordem de producao_cateter_externa_ids.';
comment on column execucao_selecoes.producao_fistula_externa_ids is
  'Ids de SUB-LOTE (fin-lotes.id) com as guias de FÍSTULA do médico Angiologista, geralmente 1 por quinzena — mesma semântica de producao_cateter_externa_ids (somados, 1x1).';
comment on column execucao_selecoes.producao_fistula_nomes is
  'Snapshot dos nomes dos sub-lotes de fístula exibidos na escolha, mesma ordem do array de ids.';
comment on column execucao_selecoes.producao_angiografia_externa_ids is
  'Ids de SUB-LOTE (fin-lotes.id) com as guias de ANGIOGRAFIA do médico Angiologista, geralmente 1 por quinzena — TODOS somados antes de contar 3x1 (teto(n/3)) com exceção de Intra-operatório.';
comment on column execucao_selecoes.producao_angiografia_nomes is
  'Snapshot dos nomes dos sub-lotes de angiografia exibidos na escolha, mesma ordem do array de ids.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   add column if not exists producao_cateter_externa_id text,
--   add column if not exists producao_cateter_nome text,
--   add column if not exists producao_fistula_externa_id text,
--   add column if not exists producao_fistula_nome text,
--   add column if not exists producao_angiografia_externa_id text,
--   add column if not exists producao_angiografia_nome text;
-- -- CUIDADO: só recupera o PRIMEIRO id/nome de cada array — perde os demais se alguma linha
-- -- tiver mais de 1 sub-lote selecionado.
-- update execucao_selecoes set producao_cateter_externa_id = producao_cateter_externa_ids[1];
-- update execucao_selecoes set producao_cateter_nome = producao_cateter_nomes[1];
-- update execucao_selecoes set producao_fistula_externa_id = producao_fistula_externa_ids[1];
-- update execucao_selecoes set producao_fistula_nome = producao_fistula_nomes[1];
-- update execucao_selecoes set producao_angiografia_externa_id = producao_angiografia_externa_ids[1];
-- update execucao_selecoes set producao_angiografia_nome = producao_angiografia_nomes[1];
-- alter table execucao_selecoes
--   drop column if exists producao_cateter_externa_ids,
--   drop column if exists producao_cateter_nomes,
--   drop column if exists producao_fistula_externa_ids,
--   drop column if exists producao_fistula_nomes,
--   drop column if exists producao_angiografia_externa_ids,
--   drop column if exists producao_angiografia_nomes;
