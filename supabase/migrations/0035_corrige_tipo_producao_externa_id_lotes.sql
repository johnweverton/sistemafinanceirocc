-- Migration 0035 — corrige o tipo das colunas de lote separado em execucao_selecoes.
--
-- Causa raiz: a migration 0011 criou producao_externa_id como uuid; a 0012 corrigiu para text
-- porque a API real da Carmem devolve IDs NUMÉRICOS (ex.: "313"), não UUIDs (Épico 5, contrato
-- real ≠ presumido). As migrations 0026 (lote de consultas de pediatria, Story 10.2) e 0034
-- (lotes de Outros Hospitais/Imobilizações, Story 10.5) repetiram o mesmo erro ao criar suas
-- colunas como uuid — todo INSERT com o id real da produção falhava com "invalid input syntax
-- for type uuid" (500 "Erro interno"). Reproduzido em produção: Dr. Marcel Rolim Queiroz,
-- competência 2026-04, lote "Outros Hospitais 2026".
--
-- producao_consultas_externa_id (0026) nunca tinha disparado o erro em produção até agora
-- (nenhum pediatra usou o seletor ainda), mas tem exatamente o mesmo defeito — corrigido aqui
-- por precaução, mesmo padrão da correção original (0012).
--
-- Mudança relaxante e sem perda: uuid::text preserva os valores existentes (hoje só null, já
-- que nenhum insert com esses campos chegou a persistir).

alter table execucao_selecoes
  alter column producao_consultas_externa_id type text using producao_consultas_externa_id::text;

alter table execucao_selecoes
  alter column producao_outros_hospitais_externa_id type text using producao_outros_hospitais_externa_id::text;

alter table execucao_selecoes
  alter column producao_imobilizacoes_externa_id type text using producao_imobilizacoes_externa_id::text;

comment on column execucao_selecoes.producao_consultas_externa_id is
  'ID da produção de consultas de pediatria na origem (fin-producoes.id — numérico serializado como texto, Story 10.2). Corrigido de uuid para text na 0035 (mesmo motivo da 0012).';
comment on column execucao_selecoes.producao_outros_hospitais_externa_id is
  'ID da produção de Outros Hospitais na origem (fin-producoes.id — numérico serializado como texto, Story 10.5). Corrigido de uuid para text na 0035 (mesmo motivo da 0012).';
comment on column execucao_selecoes.producao_imobilizacoes_externa_id is
  'ID da produção de Imobilizações na origem (fin-producoes.id — numérico serializado como texto, Story 10.5). Corrigido de uuid para text na 0035 (mesmo motivo da 0012).';

-- ============================================================================
-- ROLLBACK (só é seguro se todos os valores forem UUIDs válidos)
-- ============================================================================
-- alter table execucao_selecoes alter column producao_consultas_externa_id type uuid using producao_consultas_externa_id::uuid;
-- alter table execucao_selecoes alter column producao_outros_hospitais_externa_id type uuid using producao_outros_hospitais_externa_id::uuid;
-- alter table execucao_selecoes alter column producao_imobilizacoes_externa_id type uuid using producao_imobilizacoes_externa_id::uuid;
