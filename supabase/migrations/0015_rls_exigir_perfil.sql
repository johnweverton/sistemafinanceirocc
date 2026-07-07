-- Migration 0015 — Endurecimento de RLS: exigir perfil existente (Auditoria 2026-07-07, achado A-3).
--
-- ANTES:  todas as policies de SELECT usavam auth.role() = 'authenticated', o que significa
--         que qualquer JWT válido do Supabase (incluindo signup aberto) dava acesso de leitura
--         a TODAS as tabelas. Combinado com signup aberto, qualquer pessoa na internet podia
--         ler CPFs, valores financeiros e histórico de alterações via PostgREST direto.
--
-- DEPOIS: SELECT exige que o uid() tenha um registro em profiles — sem perfil, sem acesso.
--         Isso garante que mesmo com signup aberto (pendência externa A-2), um usuário sem
--         perfil provisionado por admin não lê nada.
--
-- Função auxiliar has_profile(): evita repetir o subselect em cada policy e facilita
-- manutenção futura (ex.: adicionar cache ou condições adicionais).
--
-- Rollback comentado no rodapé.

-- ============================================================================
-- 1. Função auxiliar reutilizável
-- ============================================================================
create or replace function public.has_profile()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid())
$$;

comment on function public.has_profile() is
  'Retorna true se o usuário autenticado tem perfil em profiles. Usada em todas as policies RLS de SELECT para garantir que JWT sem perfil não lê dados (auditoria A-3).';

-- ============================================================================
-- 2. Substituir policies de SELECT — tabela por tabela
-- ============================================================================

-- medicos
drop policy if exists medicos_select on medicos;
create policy medicos_select on medicos for select using (has_profile());

-- medicos_historico
drop policy if exists medicos_historico_select on medicos_historico;
create policy medicos_historico_select on medicos_historico for select using (has_profile());

-- precos
drop policy if exists precos_select on precos;
create policy precos_select on precos for select using (has_profile());

-- execucoes
drop policy if exists execucoes_select on execucoes;
create policy execucoes_select on execucoes for select using (has_profile());

-- execucao_resultados
drop policy if exists execucao_resultados_select on execucao_resultados;
create policy execucao_resultados_select on execucao_resultados for select using (has_profile());

-- execucao_selecoes (adicionada na 0011)
drop policy if exists execucao_selecoes_select on execucao_selecoes;
create policy execucao_selecoes_select on execucao_selecoes for select using (has_profile());

-- boletos (adicionada na 0004) — já tinha restrição admin/financeiro, agora usa has_profile() + papel
drop policy if exists "Leitura de boletos para admin e financeiro" on boletos;
create policy boletos_select on boletos for select using (
  has_profile()
  and auth.uid() in (select id from profiles where papel in ('admin', 'financeiro'))
);

-- profiles — manter a lógica especial (próprio perfil OU admin lê todos),
-- mas agora via has_profile() para consistência.
drop policy if exists profiles_select_proprio on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.papel = 'admin')
);

-- execucoes INSERT — também endurecer: exigir perfil + papel
drop policy if exists execucoes_insert on execucoes;
create policy execucoes_insert on execucoes for insert with check (
  has_profile()
  and auth.uid() in (select id from profiles where papel in ('admin', 'colaborador'))
);

-- medicos WRITE — endurecer: has_profile() + admin
drop policy if exists medicos_write_admin on medicos;
create policy medicos_write_admin on medicos for all using (
  has_profile()
  and auth.uid() in (select id from profiles where papel = 'admin')
);

-- precos WRITE — endurecer: has_profile() + admin
drop policy if exists precos_write_admin on precos;
create policy precos_write_admin on precos for all using (
  has_profile()
  and auth.uid() in (select id from profiles where papel = 'admin')
);

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop function if exists public.has_profile();
-- Em seguida, re-criar as policies originais da 0002/0004/0011 com auth.role() = 'authenticated'.
