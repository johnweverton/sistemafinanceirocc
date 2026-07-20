-- Migration 0026 — consultas ambulatoriais de pediatria (Story 10.2, Épico 10).
-- GATE do dono (2026-07-20, corrigida): a equipe lança um LOTE SEPARADO (produção distinta,
-- na origem/fin-producoes) só com as consultas do pediatra — não é entrada manual, dá pra
-- buscar via API. Isso quebra a premissa de "1 produção por médico por execução"
-- (uq_execucao_selecoes da migration 0011), então a produção de consultas vira uma SEGUNDA
-- referência OPCIONAL na MESMA linha de seleção, não uma segunda linha — preserva o UNIQUE
-- (execucao_id, medico_id) sem precisar relaxá-lo.
--
-- Valor unitário (R$3,00, confirmado global na GATE) entra em config_cobranca — é a única
-- tabela de config singleton que a aplicação já lê de fato em runtime (diferente de `precos`,
-- que ainda é só seed/documentação — ver comentário em precos.ts).
--
-- Backfill: colunas novas em execucao_selecoes ficam null (execuções passadas não tinham
-- componente de consultas — comportamento inalterado). config_cobranca ganha o valor default
-- 3.00 via DEFAULT da coluna, sem migration de dados adicional (upsert por id=1 já existe).
-- Idempotente: add column if not exists. Rollback no rodapé.

alter table execucao_selecoes
  add column if not exists producao_consultas_externa_id uuid,
  add column if not exists producao_consultas_nome text;

comment on column execucao_selecoes.producao_consultas_externa_id is
  'Produção separada (fin-producoes.id) com as consultas ambulatoriais do pediatra (Story 10.2). Null = sem componente de consultas nesta seleção.';
comment on column execucao_selecoes.producao_consultas_nome is
  'Snapshot do nome da produção de consultas exibido na escolha (mesmo padrão de producao_nome).';

alter table config_cobranca
  add column if not exists valor_consulta_pediatria numeric(10,2) not null default 3.00;

comment on column config_cobranca.valor_consulta_pediatria is
  'Valor unitário (R$) de cada consulta ambulatorial de pediatria (Story 10.2) — global, editável sem deploy. Default 3.00 confirmado pelo dono na GATE (2026-07-20).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table config_cobranca drop column if exists valor_consulta_pediatria;
-- alter table execucao_selecoes
--   drop column if exists producao_consultas_externa_id,
--   drop column if exists producao_consultas_nome;
