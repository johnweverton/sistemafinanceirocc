-- Migration 0021 — conta emissora (Story 7.1, Épico 7).
-- A empresa opera com DUAS contas Cora: MC (configurada) e Cavalcante Viana (pendente).
-- Fonte: docs/architecture/feature-multi-conta-emissora.md (D1/D2/D3 aprovadas pelo dono 2026-07-10).
--
-- Decisões refletidas aqui:
--   - D1-A: conta emissora é atributo do MÉDICO (relação contratual estável).
--   - boletos.conta_emissora é DESNORMALIZAÇÃO PROPOSITAL: o boleto guarda a conta que o
--     emitiu de fato — se o médico trocar de empresa, cancelamento e conciliação dos boletos
--     antigos continuam pela conta original (arquitetura §3).
--
-- Backfill: default 'mc' em ambas as colunas → todos os registros existentes preservam o
-- comportamento atual (Gold Standard Baseline; sistema segue 100% MC até configurar a CV).
-- Idempotente: add column if not exists + CHECKs com drop/add nomeado (padrão 0018).

alter table medicos
  add column if not exists conta_emissora text not null default 'mc';

alter table medicos drop constraint if exists chk_medicos_conta_emissora;
alter table medicos add constraint chk_medicos_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana'));

alter table boletos
  add column if not exists conta_emissora text not null default 'mc';

alter table boletos drop constraint if exists chk_boletos_conta_emissora;
alter table boletos add constraint chk_boletos_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana'));

comment on column medicos.conta_emissora is
  'Conta Cora que emite os boletos deste médico (Épico 7): mc (default) ou cavalcante_viana. Atributo contratual — define o beneficiário das PRÓXIMAS emissões.';
comment on column boletos.conta_emissora is
  'Conta Cora pela qual ESTE boleto foi emitido (desnormalização proposital, arquitetura §3): cancelamento e reconsulta usam SEMPRE esta coluna, nunca a conta atual do médico.';

-- ============================================================================
-- vw_recebiveis — mesma definição da 0020 + coluna conta_emissora (aditivo).
-- security_invoker = on preservado (defesa em profundidade via RLS de boletos).
-- ============================================================================
create or replace view vw_recebiveis
with (security_invoker = on) as
select
  b.id                       as boleto_id,
  b.execucao_resultado_id    as execucao_resultado_id,
  b.id_externo               as id_externo,
  e.competencia              as competencia,
  r.medico_id                as medico_id,
  r.nome                     as nome,
  r.total_valor              as valor,
  b.vencimento               as vencimento,
  b.pago_em                  as pago_em,
  b.valor_pago               as valor_pago,
  b.emitido_em               as emitido_em,
  case
    when b.pago_em is not null or b.status = 'pago' then 'pago'
    when b.status = 'cancelado'                     then 'cancelado'
    when b.vencimento is not null
         and b.vencimento < current_date            then 'vencido'
    else 'em_aberto'
  end                        as status_derivado,
  -- QA-711-1: coluna nova SEMPRE no FINAL — create or replace view não aceita
  -- inserção no meio da lista (erro "cannot change name of view column").
  b.conta_emissora           as conta_emissora
from boletos b
  join execucao_resultados r on r.id = b.execucao_resultado_id
  join execucoes e           on e.id = r.execucao_id
where b.status <> 'falha';

comment on view vw_recebiveis is
  'Contas a Receber: boletos + resultado + competencia com status derivado (pago/cancelado/vencido/em_aberto) e conta emissora (Épico 7). Exclui falhas de emissão. security_invoker=on respeita a RLS das tabelas base.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- Reaplicar a definição da 0020 da vw_recebiveis (sem conta_emissora); depois:
-- alter table boletos drop constraint if exists chk_boletos_conta_emissora;
-- alter table boletos drop column if exists conta_emissora;
-- alter table medicos drop constraint if exists chk_medicos_conta_emissora;
-- alter table medicos drop column if exists conta_emissora;
