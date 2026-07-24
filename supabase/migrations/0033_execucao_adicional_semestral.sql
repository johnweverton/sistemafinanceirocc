-- Migration 0033 — flag de adicional semestral em execuções (Story 11.4, Epic 11).
-- Depende da 11.3 (execucoes.cliente_contabilidade_id). Reaproveita o mesmo pipeline: o adicional
-- é só uma 2ª execução no ciclo do cliente contábil, marcada `eh_adicional = true` — sem tabela
-- nova (decisão D4 do desenho arquitetural, docs/architecture/feature-emissao-contabilidade.md).

alter table execucoes
  add column if not exists eh_adicional boolean not null default false;

comment on column execucoes.eh_adicional is
  'Marca esta execução como o boleto avulso do adicional semestral de um cliente contábil (Story 11.4) — separado do boleto mensal normal. Default false preserva 100% o comportamento das execuções existentes (médico/empresa/cliente contábil mensal).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucoes drop column if exists eh_adicional;
