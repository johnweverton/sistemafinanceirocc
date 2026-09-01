-- Migration 0057 — config_lembrete_vencimento: toggle de habilitar/desabilitar o lembrete
-- automático de vencimento D-1 (Épico 13, Fase 1). Mesmo padrão de config_relatorio_mensal
-- (0054): singleton id=1, RLS leitura autenticada / escrita admin. Mais simples que aquela —
-- sem lista de destinatários configurável, porque o destinatário do lembrete é sempre o próprio
-- pagador do boleto (WhatsApp/e-mail do médico/empresa/cliente contábil), resolvido em runtime.
--
-- Idempotente: seguro para rodar mais de uma vez (if not exists / guards / on conflict).

create table if not exists config_lembrete_vencimento (
  id         integer primary key default 1 check (id = 1), -- garante linha única
  habilitado boolean not null default false, -- default OFF: rollout seguro, ativado manualmente
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed idempotente: 1 linha em estado "desabilitado" — o cron roda todo dia mas fica no-op até
-- alguém ligar pela tela de Configurações.
insert into config_lembrete_vencimento (id)
values (1)
on conflict (id) do nothing;

-- RLS: mesma política de config_relatorio_mensal (0054) — leitura autenticada, escrita admin.
alter table config_lembrete_vencimento enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'config_lembrete_vencimento' and policyname = 'config_lembrete_vencimento_select'
  ) then
    create policy config_lembrete_vencimento_select on config_lembrete_vencimento
      for select using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'config_lembrete_vencimento' and policyname = 'config_lembrete_vencimento_write_admin'
  ) then
    create policy config_lembrete_vencimento_write_admin on config_lembrete_vencimento
      for all
      using      (exists (select 1 from profiles where id = auth.uid() and papel = 'admin'))
      with check (exists (select 1 from profiles where id = auth.uid() and papel = 'admin'));
  end if;
end $$;

comment on table config_lembrete_vencimento is
  'Toggle do lembrete automático de vencimento D-1 (singleton, id=1). Épico 13 Fase 1. '
  'Editável em Configurações.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop table if exists config_lembrete_vencimento;
