-- Migration 0058 — Contagem de guias informada MANUALMENTE por planilha (função alternativa,
-- aprovada pelo dono 2026-09-03). Mesmo mecanismo da 0045 (Carta de Rede do Angiologista),
-- generalizado: lá o número manual era a ÚNICA fonte de um lote específico de UMA especialidade;
-- aqui ele SUBSTITUI a contagem automática (`contarGuiasProducao`) do lote principal de QUALQUER
-- médico, só naquela competência e só para os médicos que vierem na planilha.
--
-- PORQUÊ: a auditoria da contagem 3x1 (2026-09-02) corrigiu 7 bugs, mas restaram casos em que a
-- contagem automática ainda diverge da conferência manual do dono (lista de exceção do urologista,
-- agrupamento por via de acesso etc.) cuja causa ainda NÃO foi confirmada com dado real. Em vez de
-- adivinhar a regra e mudar o valor cobrado de todo mundo (decisão de negócio, não de código), o
-- operador informa o total JÁ CONFERIDO à mão desses médicos e o motor pula a contagem só neles.
-- Execução MISTA é o caso normal: na mesma competência, quem não está na planilha continua 100%
-- no fluxo automático.
--
-- `guias_manuais_motivo` é o texto da coluna "motivo" da planilha e aparece no ALERTA do relatório
-- interno (`execucao_resultados.alertas`) — nunca no boleto nem em nada visível ao médico/Cora.
-- Por isso ele é obrigatório sempre que `guias_manuais_total` vem preenchido; a obrigatoriedade
-- é validada no schema Zod (dispararExecucaoSchema) e não como CHECK de banco, seguindo o padrão
-- já usado nos demais campos condicionais de `execucao_selecoes` (a coerência entre colunas de uma
-- seleção sempre foi responsabilidade da camada de validação de payload).
-- `guias_manuais_informado_por`/`_em` seguem o mesmo padrão de auditoria de número digitado
-- manualmente de `carta_rede_informado_por/_em` (0045) e de
-- `clientes_contabilidade_faturamentos.informado_por/_em` (0031).

alter table execucao_selecoes
  add column if not exists guias_manuais_total integer,
  add column if not exists guias_manuais_motivo text,
  add column if not exists guias_manuais_informado_por uuid references profiles(id),
  add column if not exists guias_manuais_informado_em timestamptz;

alter table execucao_selecoes drop constraint if exists chk_execucao_selecoes_guias_manuais_total;
alter table execucao_selecoes add constraint chk_execucao_selecoes_guias_manuais_total
  check (guias_manuais_total is null or guias_manuais_total >= 0);

comment on column execucao_selecoes.guias_manuais_total is
  'Total de guias do lote PRINCIPAL já conferido MANUALMENTE pelo dono, importado de planilha (aprovado 2026-09-03). Null = contagem automática normal (caso comum). Preenchido = o motor NÃO roda contarGuiasProducao/consolidarProducao para este médico nesta competência e usa este número; cirurgias vai a 0 (não dá pra derivar de um total agregado) e as consultas ambulatoriais do pediatra continuam sendo contadas normalmente (fonte de dado diferente).';
comment on column execucao_selecoes.guias_manuais_motivo is
  'Motivo/observação da coluna "motivo" da planilha — obrigatório quando guias_manuais_total está preenchido (validado no dispararExecucaoSchema). Vira alerta no relatório interno; NUNCA aparece no boleto nem em nada visível ao médico/Cora. GATE do dono 2026-09-03: esse alerta NÃO derruba o status do resultado para "alerta" (é auditoria, não pendência de conferência) — o resultado sai "ok" e pode ser emitido direto, sem passar pelo "Revisar e liberar".';
comment on column execucao_selecoes.guias_manuais_informado_por is
  'profiles.id de quem importou a planilha com guias_manuais_total — mesmo padrão de carta_rede_informado_por.';
comment on column execucao_selecoes.guias_manuais_informado_em is
  'Timestamp de quando guias_manuais_total foi informado.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   drop constraint if exists chk_execucao_selecoes_guias_manuais_total,
--   drop column if exists guias_manuais_total,
--   drop column if exists guias_manuais_motivo,
--   drop column if exists guias_manuais_informado_por,
--   drop column if exists guias_manuais_informado_em;
