-- Migration 0048 — Acúmulo de guias abaixo do mínimo (achado real 2026-08-13, regra da
-- coordenadora financeira, nunca antes traduzida em regra de sistema): médico com MENOS DE 5
-- guias combinadas (soma de todos os lotes da competência, exceto consultas de pediatria) NÃO
-- gera boleto naquele mês — a produção fica retida e some com o próximo mês em que ele for
-- processado, até o total bater 5+ (aí sim gera 1 boleto só, com a soma). Exemplo confirmado:
-- Julho = 3 guias (retido) + Agosto = 5 novas → boleto de Agosto com 8 guias.
--
-- Consultas de pediatria NÃO têm bucket aqui (de propósito): continuam sendo cobradas todo mês
-- em que existirem, independente do limiar de guias — mesmo comportamento pré-existente de
-- "sem guias hospitalares mas com consultas → cobra só as consultas". Reter consultas junto com
-- guias faria um pediatra que só faz consultas ambulatoriais (guias sempre 0) nunca mais ser
-- cobrado — regressão real, não hipotética.
--
-- Duas peças de schema:
--   1. Novo status 'acumulado' em execucao_resultados.status (+ coluna de totais em execucoes).
--   2. Tabela nova medicos_saldo_acumulado — ÚNICO estado do sistema que sobrevive ENTRE
--      competências, ligado ao médico (não à execução). Sem precedente: todo o resto do schema é
--      por-execução/por-competência.

-- ============================================================================
-- 1. Status 'acumulado'
-- ============================================================================

alter table execucao_resultados drop constraint if exists execucao_resultados_status_check;
alter table execucao_resultados add constraint execucao_resultados_status_check
  check (status in ('ok','alerta','sem_dados','acumulado'));

alter table execucoes add column if not exists total_acumulado integer;

comment on constraint execucao_resultados_status_check on execucao_resultados is
  '4º status "acumulado" (migration 0048): produção retida abaixo do limiar de 5 guias combinadas — total_valor sempre 0, nunca elegível pra emissão (mesma trava de status != ''ok'' em emitir-boleto.ts).';
comment on column execucoes.total_acumulado is
  'Quantos médicos desta execução ficaram com status ''acumulado'' (produção retida, sem boleto) — migration 0048.';

-- ============================================================================
-- 2. Saldo acumulado por médico (sobrevive entre competências)
-- ============================================================================

create table if not exists medicos_saldo_acumulado (
  medico_id uuid primary key references medicos(id),
  guias_principal integer not null default 0,
  guias_outros_hospitais integer not null default 0,
  guias_imobilizacoes integer not null default 0,
  valor_base_percentual numeric(12,2) not null default 0,
  competencia_origem text not null,
  execucao_resultado_id_origem uuid references execucao_resultados(id),
  atualizado_em timestamptz not null default now(),
  constraint chk_saldo_acumulado_nao_negativo check (
    guias_principal >= 0 and guias_outros_hospitais >= 0 and guias_imobilizacoes >= 0
    and valor_base_percentual >= 0
  )
);

comment on table medicos_saldo_acumulado is
  'Produção retida de médico com menos de 5 guias combinadas numa competência (migration 0048) — 1 linha por médico (upsert), apagada quando o saldo é finalmente consumido num boleto. Único estado do schema que atravessa competências (todo o resto é por-execução).';
comment on column medicos_saldo_acumulado.guias_principal is
  'Guias retidas do lote PRINCIPAL (HAPVIDA_CRED/NAO_CRED de médico normal, OU total combinado Cateter+Fístula+Angiografia+Carta de Rede do Angiologista — os dois convergem pra 1 classe/tabela só, sem caso especial).';
comment on column medicos_saldo_acumulado.guias_outros_hospitais is
  'Guias retidas do lote separado de OUTROS_HOSPITAIS (Story 10.5) — bucket independente do principal, nunca somado com ele.';
comment on column medicos_saldo_acumulado.guias_imobilizacoes is
  'Guias retidas do lote separado de IMOBILIZACOES (Story 10.5) — bucket independente.';
comment on column medicos_saldo_acumulado.valor_base_percentual is
  'Soma de valorCobradoOrigem retida (só relevante no modoCobranca=percentual_producao) — guardada como BASE bruta, não como valor final calculado, porque base×percentual é linear mas o resultado final de dois meses separados não pode simplesmente ser somado com segurança para as demais formas de preço (faixa/base+excedente não são lineares); manter a base bruta e recalcular tudo junto no mês que consome o saldo evita essa armadilha em qualquer modo.';
comment on column medicos_saldo_acumulado.competencia_origem is
  'Competência (AAAA-MM) em que este saldo começou a acumular — snapshot pra exibir "acumulando desde ..." na UI, nunca atualizado depois da primeira vez que a linha é criada.';
comment on column medicos_saldo_acumulado.execucao_resultado_id_origem is
  'Resultado (status=''acumulado'') mais recente que gerou/atualizou esta linha — rastreabilidade (nunca chuta de onde veio um número, PRD §2).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop table if exists medicos_saldo_acumulado;
-- alter table execucoes drop column if exists total_acumulado;
-- -- CUIDADO: só reverter o CHECK abaixo se NENHUM resultado tiver status='acumulado' (senão a
-- -- constraint falha) — nesse caso, decidir manualmente o que fazer com essas linhas primeiro.
-- alter table execucao_resultados drop constraint if exists execucao_resultados_status_check;
-- alter table execucao_resultados add constraint execucao_resultados_status_check
--   check (status in ('ok','alerta','sem_dados'));
