-- Migration 0034 — lotes separados de Outros Hospitais/Imobilizações (Story 10.5, Épico 10).
-- Bug real corrigido: o motor reaproveitava a MESMA contagem de guias do lote principal
-- (`producao_externa_id`) para a tabela de OUTROS_HOSPITAIS/IMOBILIZACOES, cobrando a mesma
-- produção 2x em tabelas diferentes (Dr. Marcel Rolim Queiroz — 50 guias do lote principal
-- aplicadas tanto em HAPVIDA_CRED quanto em OUTROS_HOSPITAIS, em vez de 42 Hapvida + 19 Outros
-- Hospitais, cada lote na sua própria produção/tabela).
--
-- Mesmo padrão da migration 0026 (lote de consultas de pediatria): produção SEPARADA e
-- OPCIONAL na MESMA linha de execucao_selecoes (preserva o UNIQUE execucao_id+medico_id da
-- migration 0011, sem precisar de uma segunda linha por médico).
--
-- Backfill: colunas novas ficam null (execuções passadas não tinham os lotes separados
-- selecionados — comportamento inalterado para leitura; o cálculo só muda daqui pra frente).
-- Idempotente: add column if not exists. Rollback no rodapé.

alter table execucao_selecoes
  add column if not exists producao_outros_hospitais_externa_id uuid,
  add column if not exists producao_outros_hospitais_nome text,
  add column if not exists producao_imobilizacoes_externa_id uuid,
  add column if not exists producao_imobilizacoes_nome text;

comment on column execucao_selecoes.producao_outros_hospitais_externa_id is
  'Produção separada (fin-producoes.id) com as guias de OUTROS_HOSPITAIS do médico (Story 10.5). Null = médico com fazOutrosHospitais mas sem o lote selecionado nesta execução — o motor gera alerta e não cobra a classe (nunca reaproveita a contagem do lote principal).';
comment on column execucao_selecoes.producao_outros_hospitais_nome is
  'Snapshot do nome da produção de outros hospitais exibido na escolha (mesmo padrão de producao_nome).';
comment on column execucao_selecoes.producao_imobilizacoes_externa_id is
  'Produção separada (fin-producoes.id) com as guias de IMOBILIZACOES do médico (Story 10.5). Mesma semântica de producao_outros_hospitais_externa_id.';
comment on column execucao_selecoes.producao_imobilizacoes_nome is
  'Snapshot do nome da produção de imobilizações exibido na escolha (mesmo padrão de producao_nome).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   drop column if exists producao_outros_hospitais_externa_id,
--   drop column if exists producao_outros_hospitais_nome,
--   drop column if exists producao_imobilizacoes_externa_id,
--   drop column if exists producao_imobilizacoes_nome;
