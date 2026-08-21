-- Migration 0052 — Sub-lotes de Consultas de Pediatria (achado 2026-08-21): a produção mensal do
-- pediatra pode ter a MESMA estrutura de sub-lotes do Angiologista (fin-lotes) — ex.: dentro da
-- produção "JULHO - 2026" do painel de origem, existem sub-lotes "HUMBERTO 1Q"/"HUMBERTO PARECER
-- 1Q"/"HUMBERTO 2,5KG 1Q"/"HUMBERTO 2Q" (guias) e "HUMBERTO CONSULTAS DE JUNHO" (consultas) — tudo
-- somado no cabeçalho "60 guias" da produção mensal, sem distinção. Até aqui, `producao_externa_id`
-- buscava a produção mensal INTEIRA (fin-producoes) — se um sub-lote de consulta fosse escolhido
-- separadamente ele entraria 2x na conta (a origem não expõe um campo "pertence ao sub-lote X" no
-- item, então não dá pra subtrair depois).
--
-- Fix: quando o operador marca um sub-lote como consulta, o principal deixa de vir da produção
-- completa e passa a ser a SOMA dos demais sub-lotes (tudo que não foi marcado como consulta,
-- resolvido no cliente a partir da mesma lista de fin-lotes — computação AUTOMÁTICA, o operador só
-- marca o(s) sub-lote(s) de consulta). Nunca populado junto com `producao_externa_id`/
-- `producao_consultas_externa_id` — o Orchestrator prioriza os arrays quando presentes.
--
-- Sem backfill: feature nova, nenhuma execução real usou esses campos até agora.

alter table execucao_selecoes
  add column if not exists producao_consultas_lote_externa_ids text[],
  add column if not exists producao_consultas_lote_nomes text[],
  add column if not exists producao_guias_lote_externa_ids text[],
  add column if not exists producao_guias_lote_nomes text[];

comment on column execucao_selecoes.producao_consultas_lote_externa_ids is
  'Ids de SUB-LOTE (fin-lotes.id) marcados como CONSULTAS dentro da produção mensal do pediatra (achado 2026-08-21) — mutuamente exclusivo com producao_consultas_externa_id (produção flat). Busca de itens usa loteId por cada id do array, nunca producaoId. Presente e não-vazio → o motor soma os itens desses sub-lotes como itensConsultas (mesmo componente CONSULTA_PEDIATRIA de sempre), NUNCA reaproveitando producao_externa_id.';
comment on column execucao_selecoes.producao_consultas_lote_nomes is
  'Snapshot dos nomes dos sub-lotes de consulta exibidos na escolha, mesma ordem de producao_consultas_lote_externa_ids.';
comment on column execucao_selecoes.producao_guias_lote_externa_ids is
  'Ids de SUB-LOTE (fin-lotes.id) que formam o PRINCIPAL (guias) quando producao_consultas_lote_externa_ids está preenchido — todos os sub-lotes da produção mensal MENOS os marcados como consulta, computado no cliente. Presente → o motor soma esses sub-lotes como itens (guia principal) em vez de buscar producao_externa_id inteiro (anti-dupla-contagem: o sub-lote de consulta nunca aparece aqui).';
comment on column execucao_selecoes.producao_guias_lote_nomes is
  'Snapshot dos nomes dos sub-lotes de guia exibidos na escolha, mesma ordem de producao_guias_lote_externa_ids.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   drop column if exists producao_consultas_lote_externa_ids,
--   drop column if exists producao_consultas_lote_nomes,
--   drop column if exists producao_guias_lote_externa_ids,
--   drop column if exists producao_guias_lote_nomes;
