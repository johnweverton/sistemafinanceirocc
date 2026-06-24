-- Migration 0002 — Row Level Security (RLS).
-- Fonte: docs/architecture.md (Database Schema, seção RLS).
-- Leitura por papel; escrita em médicos restrita a admin; escrita em execuções/resultados/
-- histórico é sempre feita pelo servidor com a service role (bypassa RLS) — não há policy
-- de escrita para clientes nessas tabelas.

alter table profiles enable row level security;
alter table medicos enable row level security;
alter table medicos_historico enable row level security;
alter table precos enable row level security;
alter table execucoes enable row level security;
alter table execucao_resultados enable row level security;

-- profiles: cada usuário lê o próprio perfil; admin lê todos.
create policy profiles_select_proprio on profiles for select using (
  id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.papel = 'admin')
);

-- medicos: qualquer autenticado lê; só admin escreve (PRD §8.2).
create policy medicos_select on medicos for select using (auth.role() = 'authenticated');
create policy medicos_write_admin on medicos for all using (
  exists (select 1 from profiles where id = auth.uid() and papel = 'admin')
);

-- precos: qualquer autenticado lê; só admin escreve (parâmetro de configuração).
create policy precos_select on precos for select using (auth.role() = 'authenticated');
create policy precos_write_admin on precos for all using (
  exists (select 1 from profiles where id = auth.uid() and papel = 'admin')
);

-- medicos_historico: só leitura para clientes; escrita via service role no medico-repository.
create policy medicos_historico_select on medicos_historico for select using (auth.role() = 'authenticated');

-- execucoes: qualquer autenticado lê; admin/colaborador dispara nova execução.
-- Atualização de progresso/status é do Orchestrator via service role — sem policy de update.
create policy execucoes_select on execucoes for select using (auth.role() = 'authenticated');
create policy execucoes_insert on execucoes for insert with check (
  exists (select 1 from profiles where id = auth.uid() and papel in ('admin','colaborador'))
);

-- execucao_resultados: só leitura para clientes; escrita do Orchestrator via service role.
create policy execucao_resultados_select on execucao_resultados for select using (auth.role() = 'authenticated');
