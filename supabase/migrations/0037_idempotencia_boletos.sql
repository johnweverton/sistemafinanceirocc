-- Migration 0037 — corrige 2 falhas de idempotência na emissão de boletos, achadas na revisão
-- de arquitetura do fluxo de emissão em lote (2026-07-31). Não têm relação com lote em si —
-- são bugs latentes na emissão MANUAL de hoje, só que raros o suficiente (1 clique humano por
-- vez) para nunca terem se manifestado em produção.
--
-- Achado 1: a idempotência de `POST /api/boletos/emitir` é check-then-insert em CÓDIGO
-- (buscarBoletoEmitido → criarBoleto), sem nenhuma barreira no banco. Duas requisições
-- concorrentes para o MESMO execucao_resultado_id (duplo-clique com rede lenta, retry) podem
-- passar pelo check ao mesmo tempo e gerar DOIS boletos reais na Cora para o mesmo resultado.
--
-- Achado 2: a Idempotency-Key enviada à Cora (cora-gateway.ts) é `randomUUID()` por TENTATIVA,
-- não por REGISTRO persistido. Protege contra retry de rede dentro da mesma chamada, mas não
-- contra reprocessamento nosso (timeout depois que a Cora já criou a invoice → gravamos
-- 'falha' → reprocessar gera uma chave nova → segundo boleto real).
--
-- Correção (resolve as duas juntas) — padrão "reserva antes de chamar":
--   1. INSERT do boleto com status='processando' ANTES de chamar o gateway. O índice único
--      abaixo faz o banco rejeitar a duplicata — a corrida morre no Postgres, não na aplicação.
--   2. O id da reserva (persistido) vira a Idempotency-Key enviada à Cora — determinística por
--      tentativa: reprocessar a MESMA reserva reusa a mesma chave (a Cora deduplica).
--   3. UPDATE para 'emitido'/'falha' com o payload de resposta.
--
-- Não inclui 'reaper' automático de linhas 'processando' travadas (function morta entre o
-- INSERT e o UPDATE) — considerado follow-up, fora do escopo desta correção pontual.
--
-- Aditiva/idempotente: segue o padrão da 0007 (drop/recria CHECK nomeado) e da 0020/0021
-- (create or replace view). Sem CONCURRENTLY no índice — tabela pequena (~120 boletos/mês).

-- ============================================================================
-- 1. boletos.status — ampliar CHECK para aceitar 'processando'
-- ============================================================================
do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'boletos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table boletos drop constraint %I', c);
  end loop;

  alter table boletos add constraint boletos_status_check
    check (status in ('processando', 'emitido', 'falha', 'pago', 'cancelado'));
end $$;

-- ============================================================================
-- 2. Índice único parcial — barreira real contra corrida (Achado 1).
--    'cancelado'/'falha' NÃO entram: reemitir sobre eles é legítimo (mesmo espírito de
--    buscarBoletoEmitido, que só bloqueia reemissão para 'emitido'/'pago').
-- ============================================================================
create unique index if not exists uq_boletos_resultado_ativo
  on boletos (execucao_resultado_id)
  where status in ('processando', 'emitido', 'pago');

-- ============================================================================
-- 3. vw_recebiveis — exclui 'processando' do mesmo jeito que a 0020 excluiu 'falha':
--    uma reserva ainda não confirmada pelo gateway não é um recebível (auditoria, não
--    receita em aberto). Mesma definição da 0021 (conta_emissora), só muda o WHERE final.
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
  b.conta_emissora           as conta_emissora
from boletos b
  join execucao_resultados r on r.id = b.execucao_resultado_id
  join execucoes e           on e.id = r.execucao_id
where b.status not in ('falha', 'processando');

comment on view vw_recebiveis is
  'Contas a Receber: boletos + resultado + competencia com status derivado (pago/cancelado/vencido/em_aberto) e conta emissora (Épico 7). Exclui falhas de emissão e reservas ainda não confirmadas pelo gateway. security_invoker=on respeita a RLS das tabelas base.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop index if exists uq_boletos_resultado_ativo;
-- do $$
-- begin
--   alter table boletos drop constraint if exists boletos_status_check;
--   alter table boletos add constraint boletos_status_check
--     check (status in ('emitido', 'falha', 'pago', 'cancelado'));
-- end $$;
-- Reaplicar a definição da 0021 da vw_recebiveis (where b.status <> 'falha').
