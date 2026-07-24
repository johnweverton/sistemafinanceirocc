-- Migration 0032 — execução e resultado por cliente contábil (Story 11.3, Epic 11).
-- Depende da 11.1 (tabela `clientes_contabilidade`) e 11.2 (`clientes_contabilidade_faturamentos`).
-- Mesmo padrão da migration 0029 (execução agregada por empresa, Story 10.4b): estende o mesmo
-- trio `execucoes` / `execucao_resultados`, sem tabela nova — um cliente contábil não agrega
-- produção de ninguém, então não há equivalente a `execucao_resultado_contribuicoes` aqui.

-- ============================================================================
-- 1. execucoes.cliente_contabilidade_id — marca uma execução como sendo de cliente contábil
-- ============================================================================
alter table execucoes
  add column if not exists cliente_contabilidade_id uuid references clientes_contabilidade(id);

comment on column execucoes.cliente_contabilidade_id is
  'Marca esta execução como sendo de um cliente contábil (Story 11.3) — processada sem lotes (não há médicos/produção). NULL = execução normal por médico ou agregada por empresa.';

-- ============================================================================
-- 2. execucao_resultados.cliente_contabilidade_id — resultado do cliente contábil
-- ============================================================================
-- Mesmo DESVIO CONSCIENTE documentado na migration 0029: CHECK não-XOR-estrito (só proíbe dois
-- setados ao mesmo tempo), compatível com médico legado sem vínculo (medico_id E empresa_id E
-- cliente_contabilidade_id todos null é válido).
alter table execucao_resultados
  add column if not exists cliente_contabilidade_id uuid references clientes_contabilidade(id);

alter table execucao_resultados drop constraint if exists chk_execucao_resultados_nao_ambos_medico_empresa;
alter table execucao_resultados drop constraint if exists chk_execucao_resultados_exclusao_mutua;
alter table execucao_resultados add constraint chk_execucao_resultados_exclusao_mutua
  check (
    not (medico_id is not null and empresa_id is not null)
    and not (medico_id is not null and cliente_contabilidade_id is not null)
    and not (empresa_id is not null and cliente_contabilidade_id is not null)
  );

comment on column execucao_resultados.cliente_contabilidade_id is
  'Resultado de um cliente contábil (Story 11.3) — valor único calculado por aplicarRegraPreco (Story 11.2), sem agregação. Mutuamente exclusivo com medico_id/empresa_id (constraint chk_execucao_resultados_exclusao_mutua).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_resultados drop constraint if exists chk_execucao_resultados_exclusao_mutua;
-- alter table execucao_resultados add constraint chk_execucao_resultados_nao_ambos_medico_empresa
--   check (not (medico_id is not null and empresa_id is not null));
-- alter table execucao_resultados drop column if exists cliente_contabilidade_id;
-- alter table execucoes drop column if exists cliente_contabilidade_id;
