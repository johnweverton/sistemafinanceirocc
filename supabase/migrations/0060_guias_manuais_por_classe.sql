-- Migration 0060 — Contagem manual por planilha (0058), estendida para colunas POR CLASSE
-- (achado 2026-09-04, feedback do dono: "o médico pode ter produção normal, imobilizações,
-- consultas e etc... são tabelas diferentes, não tenho como colocar 200 se 100 foi guias normal
-- e 100 foi consultas"). A 0058 só cobria o lote PRINCIPAL (guias_manuais_total); um médico com
-- produção normal + Imobilizações + Consultas na mesma competência não tinha como ter cada
-- classe conferida separadamente — um total agregado misturaria valores de tabelas de preço
-- diferentes num número só.
--
-- Mesmo mecanismo da 0058, um campo por classe, todos INDEPENDENTES entre si: cada um, quando
-- preenchido, substitui a contagem automática SÓ daquela classe para aquele médico naquela
-- competência; o que não vier continua 100% automático (execução mista, mesmo espírito de
-- sempre). `guias_manuais_motivo`/`_informado_por`/`_informado_em` (já existentes desde a 0058)
-- passam a cobrir os 4 campos juntos — um motivo/timestamp só por linha da planilha, não um por
-- coluna (a planilha grava tudo numa linha só por médico).

alter table execucao_selecoes
  add column if not exists guias_manuais_consultas integer,
  add column if not exists guias_manuais_imobilizacoes integer,
  add column if not exists guias_manuais_outros_hospitais integer;

alter table execucao_selecoes drop constraint if exists chk_execucao_selecoes_guias_manuais_consultas;
alter table execucao_selecoes add constraint chk_execucao_selecoes_guias_manuais_consultas
  check (guias_manuais_consultas is null or guias_manuais_consultas >= 0);

alter table execucao_selecoes drop constraint if exists chk_execucao_selecoes_guias_manuais_imobilizacoes;
alter table execucao_selecoes add constraint chk_execucao_selecoes_guias_manuais_imobilizacoes
  check (guias_manuais_imobilizacoes is null or guias_manuais_imobilizacoes >= 0);

alter table execucao_selecoes drop constraint if exists chk_execucao_selecoes_guias_manuais_outros_hospitais;
alter table execucao_selecoes add constraint chk_execucao_selecoes_guias_manuais_outros_hospitais
  check (guias_manuais_outros_hospitais is null or guias_manuais_outros_hospitais >= 0);

comment on column execucao_selecoes.guias_manuais_consultas is
  'Total de CONSULTAS ambulatoriais do pediatra já conferido MANUALMENTE, importado de planilha (achado 2026-09-04). Null = contagem automática normal (consultasValidas.length). Preenchido = o motor usa este número no lugar da contagem automática dos itens do lote de consultas, só para este médico nesta competência. Só tem efeito para médico Pediatra (mesmo gate da classe CONSULTA_PEDIATRIA no Engine).';
comment on column execucao_selecoes.guias_manuais_imobilizacoes is
  'Total do lote separado de IMOBILIZACOES já conferido MANUALMENTE, importado de planilha (achado 2026-09-04). Null = contagem automática normal (contarGuiasProducao dos itens do lote). Preenchido = substitui a contagem automática dessa classe para este médico nesta competência. Só tem efeito quando o médico tem Imobilizações marcado no cadastro.';
comment on column execucao_selecoes.guias_manuais_outros_hospitais is
  'Mesmo mecanismo de guias_manuais_imobilizacoes, para o lote separado de OUTROS_HOSPITAIS. Só tem efeito quando o médico tem Outros Hospitais marcado no cadastro.';

comment on column execucao_selecoes.guias_manuais_motivo is
  'Motivo/observação da coluna "motivo" da planilha — obrigatório quando QUALQUER um dos 4 campos guias_manuais_* está preenchido (validado no dispararExecucaoSchema; estendido na migration 0060 para cobrir os 3 campos novos, além do guias_manuais_total original da 0058). Vira alerta no relatório interno; NUNCA aparece no boleto nem em nada visível ao médico/Cora. GATE do dono 2026-09-03: esse alerta NÃO derruba o status do resultado para "alerta" (é auditoria, não pendência de conferência) — o resultado sai "ok" e pode ser emitido direto, sem passar pelo "Revisar e liberar".';
comment on column execucao_selecoes.guias_manuais_informado_por is
  'profiles.id de quem importou a planilha — estendido na migration 0060 para gravar sempre que QUALQUER um dos 4 campos guias_manuais_* vier preenchido nesta linha (não só guias_manuais_total).';
comment on column execucao_selecoes.guias_manuais_informado_em is
  'Timestamp de quando a linha da planilha foi informada — mesmo gate estendido de guias_manuais_informado_por acima.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   drop constraint if exists chk_execucao_selecoes_guias_manuais_consultas,
--   drop constraint if exists chk_execucao_selecoes_guias_manuais_imobilizacoes,
--   drop constraint if exists chk_execucao_selecoes_guias_manuais_outros_hospitais,
--   drop column if exists guias_manuais_consultas,
--   drop column if exists guias_manuais_imobilizacoes,
--   drop column if exists guias_manuais_outros_hospitais;
