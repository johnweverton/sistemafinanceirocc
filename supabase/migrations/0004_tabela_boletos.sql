-- Migration 0004 — tabela de auditoria de boletos (Fase 3, PRD §10).
-- Registra cada emissão (quem pediu, quando, resposta crua do gateway).
-- Feature desligada por padrão (GATEWAY_EMISSAO_HABILITADA=false): esta tabela
-- só recebe dados quando a flag é ligada e um médico é confirmado manualmente.

create table boletos (
  id uuid primary key default gen_random_uuid(),
  execucao_resultado_id uuid not null references execucao_resultados(id),
  gateway text not null check (gateway in ('cora','mock')),
  id_externo text,           -- id devolvido pelo gateway (invoice id da Cora, etc.)
  status text not null check (status in ('emitido','falha')),
  emitido_por uuid not null references profiles(id),
  emitido_em timestamptz not null default now(),
  payload_resposta jsonb     -- resposta crua do gateway, para auditoria completa
);

create index idx_boletos_resultado on boletos (execucao_resultado_id);
create index idx_boletos_emitido_em on boletos (emitido_em);

-- RLS: leitura para autenticados com papel admin/financeiro; insert via service role apenas.
alter table boletos enable row level security;

create policy "Leitura de boletos para admin e financeiro"
  on boletos for select
  using (
    auth.uid() in (
      select id from profiles where papel in ('admin', 'financeiro')
    )
  );

-- Insert/update/delete só via service role (server-side) — sem policy de escrita para clientes.
