-- Migration 0007 — ciclo financeiro: baixa de boletos + auditoria de eventos de webhook.
-- Fonte: docs/architecture/feature-ciclo-financeiro.md §4.
-- Objetivo: permitir dar baixa nos boletos a partir do webhook do Cora (pago/cancelado) e
-- expor Contas a Receber. O status 'vencido' NÃO é armazenado — é derivado on-read
-- (vencimento < hoje e sem baixa).
--
-- Segurança: tudo ADITIVO/NULLABLE (zero downtime). Idempotente (if not exists / guards /
-- on conflict). Rollback comentado no rodapé.

-- ============================================================================
-- 1. boletos — colunas de baixa (aditivas, nullable)
-- ============================================================================
alter table boletos
  add column if not exists vencimento    date,                          -- due_date enviado ao Cora (deriva 'vencido' e aging)
  add column if not exists pago_em        timestamptz,                   -- momento da baixa
  add column if not exists valor_pago     numeric(10,2),                 -- valor efetivamente pago (suporta parcial/divergente)
  add column if not exists atualizado_em  timestamptz not null default now();

-- ============================================================================
-- 2. boletos.status — ampliar CHECK para aceitar 'pago' e 'cancelado'
--    ('vencido' é derivado on-read, NÃO entra aqui)
-- ============================================================================
-- A 0004 criou um CHECK inline sem nome (auto-gerado). Removemos qualquer CHECK que valide
-- 'status' e recriamos com nome fixo — atômico dentro do bloco DO (idempotente).
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
    check (status in ('emitido', 'falha', 'pago', 'cancelado'));
end $$;

-- ============================================================================
-- 3. boleto_eventos — auditoria de webhook + idempotência
-- ============================================================================
create table if not exists boleto_eventos (
  id                   uuid primary key default gen_random_uuid(),
  boleto_id            uuid references boletos(id),          -- null se o evento não casou com um boleto
  id_externo           text,                                 -- invoice id recebido no evento
  evento_id            text unique,                          -- idempotência: dedupe de reentrega do Cora
  evento_tipo          text,                                 -- ex.: 'invoice.paid', 'invoice.canceled'
  status_reconsultado  text,                                 -- status confirmado via reconsulta na API Cora
  payload              jsonb,                                -- corpo cru do webhook (auditoria)
  recebido_em          timestamptz not null default now()
);

-- ============================================================================
-- 4. Índices (access patterns: derivar vencido, filtrar por status, casar evento→boleto)
-- ============================================================================
create index if not exists idx_boletos_vencimento on boletos (vencimento);
create index if not exists idx_boletos_status on boletos (status);
create index if not exists idx_boleto_eventos_id_externo on boleto_eventos (id_externo);

-- ============================================================================
-- 5. RLS de boleto_eventos (espelha 0004_tabela_boletos.sql: leitura admin/financeiro;
--    escrita só via service role — sem policy de escrita)
-- ============================================================================
alter table boleto_eventos enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'boleto_eventos' and policyname = 'Leitura de eventos para admin e financeiro'
  ) then
    create policy "Leitura de eventos para admin e financeiro"
      on boleto_eventos for select
      using (
        auth.uid() in (select id from profiles where papel in ('admin', 'financeiro'))
      );
  end if;
end $$;

-- ============================================================================
-- 6. Documentação embutida
-- ============================================================================
comment on column boletos.vencimento is 'Data de vencimento enviada ao Cora; usada para derivar status vencido (on-read) e aging.';
comment on column boletos.pago_em     is 'Momento da baixa (webhook Cora + reconsulta).';
comment on column boletos.valor_pago  is 'Valor efetivamente pago; suporta pagamento parcial/divergente.';
comment on table  boleto_eventos      is 'Auditoria e idempotência dos eventos de webhook do Cora (evento_id UNIQUE dedupe).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop table if exists boleto_eventos;
-- do $$
-- begin
--   alter table boletos drop constraint if exists boletos_status_check;
--   alter table boletos add constraint boletos_status_check check (status in ('emitido','falha'));
-- end $$;
-- alter table boletos
--   drop column if exists vencimento,
--   drop column if exists pago_em,
--   drop column if exists valor_pago,
--   drop column if exists atualizado_em;
-- drop index if exists idx_boletos_vencimento;
-- drop index if exists idx_boletos_status;
-- drop index if exists idx_boleto_eventos_id_externo;
