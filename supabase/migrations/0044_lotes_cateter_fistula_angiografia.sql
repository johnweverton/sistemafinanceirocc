-- Migration 0044 — lotes de Cateter/Fístula/Angiografia (especialidade Angiologista, GATE
-- 2026-08-07). Mesmo padrão da 0034 (Outros Hospitais/Imobilizações): produção SEPARADA e
-- OPCIONAL na MESMA linha de execucao_selecoes (preserva o UNIQUE execucao_id+medico_id da
-- migration 0011). Tipo `text` desde o início (não `uuid` como a 0034 original) — a 0035 já
-- corrigiu esse erro pra Outros Hospitais/Imobilizações porque `fin-producoes.id` na origem é
-- um id numérico simples (ex.: "2969"), nunca um UUID de verdade.
--
-- Contexto (diferente de Outros Hospitais/Imobilizações): o médico Angiologista NÃO TEM lote
-- principal — a produção dele inteira vem desses 3 lotes (Cateter 1x1, Fístula 1x1, Angiografia
-- 3x1 + exceção Intra-operatório), cuja soma cai na MESMA faixa HAPVIDA padrão do médico (sem
-- classe/tabela de preço própria). Por isso `producao_externa_id`/`producao_nome` (o lote
-- principal) deixam de ser NOT NULL — continuam preenchidos sempre pra qualquer outra
-- especialidade, mas ficam null pro Angiologista.
--
-- Backfill: colunas novas ficam null (execuções passadas não tinham os lotes selecionados —
-- comportamento inalterado para leitura; o cálculo só muda daqui pra frente). Idempotente:
-- add column if not exists / drop not null (idempotente por natureza). Rollback no rodapé.

alter table execucao_selecoes
  alter column producao_externa_id drop not null,
  alter column producao_nome drop not null;

alter table execucao_selecoes
  add column if not exists producao_cateter_externa_id text,
  add column if not exists producao_cateter_nome text,
  add column if not exists producao_fistula_externa_id text,
  add column if not exists producao_fistula_nome text,
  add column if not exists producao_angiografia_externa_id text,
  add column if not exists producao_angiografia_nome text;

comment on column execucao_selecoes.producao_externa_id is
  'Produção principal (guias normais/Hapvida). Null = médico Angiologista, que não tem lote principal (GATE 2026-08-07) — pra qualquer outra especialidade continua sempre preenchido.';
comment on column execucao_selecoes.producao_cateter_externa_id is
  'Produção separada (fin-producoes.id) com as guias de CATETER do médico Angiologista (GATE 2026-08-07) — contadas 1x1 (sem agrupamento 3x1), cada item válido é 1 guia. Null = lote não selecionado nesta execução — o motor gera alerta e NÃO cobra (nunca reaproveita outro lote).';
comment on column execucao_selecoes.producao_cateter_nome is
  'Snapshot do nome da produção de cateter exibido na escolha (mesmo padrão de producao_nome).';
comment on column execucao_selecoes.producao_fistula_externa_id is
  'Produção separada (fin-producoes.id) com as guias de FÍSTULA do médico Angiologista (GATE 2026-08-07). Mesma semântica de producao_cateter_externa_id (1x1, sem agrupamento).';
comment on column execucao_selecoes.producao_fistula_nome is
  'Snapshot do nome da produção de fístula exibido na escolha (mesmo padrão de producao_nome).';
comment on column execucao_selecoes.producao_angiografia_externa_id is
  'Produção separada (fin-producoes.id) com as guias de ANGIOGRAFIA do médico Angiologista (GATE 2026-08-07) — contadas 3x1 (teto(n/3)) com exceção de Intra-operatório (1 guia individual, fora do pool). Null = lote não selecionado nesta execução — mesma semântica de nunca-chuta de producao_cateter_externa_id.';
comment on column execucao_selecoes.producao_angiografia_nome is
  'Snapshot do nome da produção de angiografia exibido na escolha (mesmo padrão de producao_nome).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   drop column if exists producao_cateter_externa_id,
--   drop column if exists producao_cateter_nome,
--   drop column if exists producao_fistula_externa_id,
--   drop column if exists producao_fistula_nome,
--   drop column if exists producao_angiografia_externa_id,
--   drop column if exists producao_angiografia_nome;
-- -- CUIDADO: só restaurar o NOT NULL abaixo se NENHUMA linha tiver producao_externa_id/nome
-- -- null (ou seja, nenhuma execução de médico Angiologista foi rodada ainda) — senão a
-- -- constraint falha.
-- alter table execucao_selecoes
--   alter column producao_externa_id set not null,
--   alter column producao_nome set not null;
