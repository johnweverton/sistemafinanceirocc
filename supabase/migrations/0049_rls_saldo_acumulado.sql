-- Migration 0049 — RLS em medicos_saldo_acumulado (achado da auditoria de segurança 2026-08-18).
-- A migration 0048 criou a tabela sem habilitar RLS — única tabela do schema nessa condição
-- (todas as demais, de 0001 a 0047, têm RLS + policy). Escrita real é via service role no
-- saldo-acumulado-repository.ts (bypassa RLS); a policy aqui é defesa em profundidade, mesmo
-- padrão de medicos/empresas (migrations 0015/0028): has_profile() para leitura, has_profile()
-- + admin para escrita.

alter table medicos_saldo_acumulado enable row level security;

drop policy if exists medicos_saldo_acumulado_select on medicos_saldo_acumulado;
create policy medicos_saldo_acumulado_select on medicos_saldo_acumulado for select using (has_profile());

drop policy if exists medicos_saldo_acumulado_write_admin on medicos_saldo_acumulado;
create policy medicos_saldo_acumulado_write_admin on medicos_saldo_acumulado for all using (
  has_profile()
  and auth.uid() in (select id from profiles where papel = 'admin')
);

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop policy if exists medicos_saldo_acumulado_write_admin on medicos_saldo_acumulado;
-- drop policy if exists medicos_saldo_acumulado_select on medicos_saldo_acumulado;
-- alter table medicos_saldo_acumulado disable row level security;
