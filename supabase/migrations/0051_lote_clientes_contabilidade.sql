-- Migration 0051 — cálculo em lote de clientes de contabilidade (feedback do dono, 2026-08-20):
-- hoje não existe emissão em lote para o serviço de contabilidade, só individual (1 cliente por
-- vez) — o que não dá o ganho de produtividade que o lote de médicos já dá (horas → segundos).
--
-- Achado da investigação: a emissão em lote de BOLETOS (lotes_emissao/LoteEmissaoDialog) já
-- funciona por execução/resultado, agnóstica de médico/empresa/cliente contábil
-- (validarResultadoParaEmissao já resolve o pagador pelos 3 casos) — zero mudança necessária ali.
-- O que falta é só o CÁLCULO em lote: hoje `execucoes.cliente_contabilidade_id` (migration 0032)
-- é singular — 1 execução = 1 cliente = 1 resultado, sem exceção.
--
-- Solução: coluna nova `clientes_contabilidade_ids` (array), marcador de "execução em lote de
-- clientes contábeis" — distinto do singular. Quando preenchida, N execucao_resultados são
-- gravados (um por cliente, mesmo `gravarResultadoClienteContabilidade` já usado no caso
-- singular) numa execução só, exatamente como já acontece com médicos (N resultados, 1 execução).
--
-- Aditiva/idempotente. Sem CHECK de exclusão mútua com medico/empresa/cliente_contabilidade_id
-- singular — mesmo padrão já usado por empresa_id/cliente_contabilidade_id nesta tabela
-- (aplicação garante, não o banco). Rollback comentado no rodapé.

alter table execucoes add column if not exists clientes_contabilidade_ids uuid[];

comment on column execucoes.clientes_contabilidade_ids is
  'Lote de clientes contábeis (feedback do dono 2026-08-20): quando preenchido, marca a execução como CÁLCULO EM LOTE — N clientes, 1 execução, N execucao_resultados (mesmo desenho de médico). Distinto de cliente_contabilidade_id (singular, 1 cliente por execução, migration 0032) — os dois nunca são preenchidos juntos, mas isso é garantido pela aplicação (orchestrator), não por CHECK.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucoes drop column if exists clientes_contabilidade_ids;
