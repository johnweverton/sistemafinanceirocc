-- Migration 0054 — config_relatorio_mensal: destinatário e dia de envio do relatório mensal
-- automático (cron), agora editáveis na tela de Configurações em vez de só via env var.
--
-- Antes desta migration, /api/cron/relatorio-mensal lia RELATORIO_MENSAL_EMAILS (env var) e
-- rodava só no dia 1 (schedule fixo do vercel.json). Passa a ler esta tabela; a rota mantém
-- RELATORIO_MENSAL_EMAILS como fallback ENQUANTO ninguém salvar pela tela (linha ainda no
-- estado seed abaixo: habilitado=false e emails='') — zero-downtime pra quem já tinha
-- configurado só via env var.
--
-- Idempotente: seguro para rodar mais de uma vez (if not exists / guards / on conflict).

create table if not exists config_relatorio_mensal (
  id         integer primary key default 1 check (id = 1), -- garante linha única
  emails     text not null default '', -- e-mails separados por vírgula (mesmo formato de BOOTSTRAP_ADMIN_EMAILS)
  -- Limite 28 (não 31): todo mês tem pelo menos 28 dias, evita "dia 31" sumir em meses curtos.
  dia_envio  integer not null default 1 check (dia_envio between 1 and 28),
  habilitado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed idempotente: 1 linha em estado "nunca configurado" (aciona o fallback de env var na rota).
insert into config_relatorio_mensal (id)
values (1)
on conflict (id) do nothing;

-- RLS: mesma política de config_cobranca (0006) — leitura autenticada, escrita admin.
alter table config_relatorio_mensal enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'config_relatorio_mensal' and policyname = 'config_relatorio_mensal_select'
  ) then
    create policy config_relatorio_mensal_select on config_relatorio_mensal
      for select using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'config_relatorio_mensal' and policyname = 'config_relatorio_mensal_write_admin'
  ) then
    create policy config_relatorio_mensal_write_admin on config_relatorio_mensal
      for all
      using      (exists (select 1 from profiles where id = auth.uid() and papel = 'admin'))
      with check (exists (select 1 from profiles where id = auth.uid() and papel = 'admin'));
  end if;
end $$;

comment on table config_relatorio_mensal is 'Destinatários e dia de envio do relatório mensal automático (singleton, id=1). Editável em Configurações.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop table if exists config_relatorio_mensal;
