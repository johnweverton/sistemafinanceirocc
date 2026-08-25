-- Migration 0053 — Sub-lote de Imobilizações (achado 2026-08-25): assim como a produção mensal
-- do pediatra pode ter um sub-lote de CONSULTAS dentro dela (migration 0052), a produção mensal
-- de um médico que faz Imobilizações pode ter o sub-lote de imobilizações (ex.: "1º QUINZENA
-- IMOBILIZAÇÕES") dentro da mesma produção mensal, em vez de vir como uma produção de nível-topo
-- separada. Até aqui, "Lote de Imobilizações" só listava produções flat (fin-producoes) — sem
-- opção de escolher um sub-lote (fin-lotes) diretamente, obrigando o operador a procurá-lo
-- misturado no dropdown de "Produção de consultas" (mesma lista de sub-lotes exibida ali).
--
-- Fix: novo par de colunas para o sub-lote de Imobilizações (fin-lotes.id), irmão de
-- producao_imobilizacoes_externa_id (produção flat) — mutuamente exclusivo com ela. Ao contrário
-- do sub-lote de consulta (migration 0052), não precisa de um campo irmão "resto vira guia
-- principal": Imobilizações já é uma classe totalmente separada da produção principal (tabela de
-- preço própria), então marcar o sub-lote aqui não afeta o cálculo do lote principal.
--
-- Sem backfill: feature nova, nenhuma execução real usou este campo até agora.

alter table execucao_selecoes
  add column if not exists producao_imobilizacoes_lote_externa_id text,
  add column if not exists producao_imobilizacoes_lote_nome text;

comment on column execucao_selecoes.producao_imobilizacoes_lote_externa_id is
  'Id de SUB-LOTE (fin-lotes.id) escolhido como Imobilizações dentro da produção mensal do médico (achado 2026-08-25) — mutuamente exclusivo com producao_imobilizacoes_externa_id (produção flat). Busca de itens usa loteId (buscarItensPorLote), nunca producaoId.';
comment on column execucao_selecoes.producao_imobilizacoes_lote_nome is
  'Snapshot do nome do sub-lote de imobilizações exibido na escolha.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   drop column if exists producao_imobilizacoes_lote_externa_id,
--   drop column if exists producao_imobilizacoes_lote_nome;
