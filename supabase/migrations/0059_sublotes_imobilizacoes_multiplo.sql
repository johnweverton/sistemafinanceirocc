-- Migration 0059 — Sub-lotes MÚLTIPLOS de Imobilizações + auto-classificação Cirurgia/Imobilização
-- (achado 2026-09-03, feedback do dono): médicos VH que fazem Imobilizações têm a produção mensal
-- inteira dividida em VÁRIOS sub-lotes por dia/período (ex.: "CIRURGIAS - 05/08",
-- "IMOBILIZAÇÕES - 05/08", "CIRURGIAS 11/08 AO 12/08", "IMOBILIZAÇÕES 11/08 AO 12/08", ...), nunca
-- um único sub-lote como a migration 0053 assumia. O nome de cada sub-lote já diz a classe
-- ("CIRURGIA*" → tabela normal/guia principal, "IMOBILIZ*" → tabela de Imobilizações) — a UI passa
-- a somar TODOS os sub-lotes de cada classe automaticamente, em vez de exigir 1 escolha manual.
--
-- Fix: troca a coluna SINGULAR de sub-lote de Imobilizações (migration 0053) por um par de colunas
-- ARRAY, mesmo desenho de producao_cateter_externa_ids/producao_guias_lote_externa_ids (migrations
-- 0046/0052) — todos os sub-lotes classificados como Imobilização entram na mesma soma.
--
-- Sem backfill: a coluna singular nunca foi usada por nenhuma execução real (comentário da
-- migration 0053) — drop direto, sem perda de dado.

alter table execucao_selecoes
  drop column if exists producao_imobilizacoes_lote_externa_id,
  drop column if exists producao_imobilizacoes_lote_nome;

alter table execucao_selecoes
  add column if not exists producao_imobilizacoes_lote_externa_ids text[],
  add column if not exists producao_imobilizacoes_lote_nomes text[];

comment on column execucao_selecoes.producao_imobilizacoes_lote_externa_ids is
  'Ids de SUB-LOTE (fin-lotes.id) classificados como Imobilizações dentro da produção mensal do médico (achado 2026-09-03, substitui a coluna singular da migration 0053) — mutuamente exclusivo com producao_imobilizacoes_externa_id (produção flat). Busca de itens usa loteId (buscarItensPorLote) para cada um, somando o resultado.';
comment on column execucao_selecoes.producao_imobilizacoes_lote_nomes is
  'Snapshot dos nomes dos sub-lotes de imobilizações exibidos na escolha (auditoria).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   drop column if exists producao_imobilizacoes_lote_externa_ids,
--   drop column if exists producao_imobilizacoes_lote_nomes;
-- alter table execucao_selecoes
--   add column if not exists producao_imobilizacoes_lote_externa_id text,
--   add column if not exists producao_imobilizacoes_lote_nome text;
