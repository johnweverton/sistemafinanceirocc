-- Migration 0062 — solicitações de busca no ISS feitas pelo sistema web (Story 13.5, Épico 13).
-- Arquitetura: docs/architecture/feature-agente-faturamento-iss.md.
--
-- Fase 2 do agente: o operador clica em "Buscar no ISS" no diálogo de lote, uma SOLICITAÇÃO fica
-- registrada aqui, e o agente local (vigiando ou agendado na máquina do escritório) a reivindica,
-- executa e relata o progresso de volta. A senha do ISS continua só na máquina do escritório
-- (decisão G4): esta tabela não guarda credencial nenhuma — só o pedido e o andamento.
--
-- Aplicação MANUAL no Supabase pelo dono (mesmo processo da 0061).

-- ============================================================================
-- 1. Solicitações
-- ============================================================================
create table if not exists iss_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,
  -- null = carteira inteira de `faixa_faturamento`; preenchido = só estes CPF/CNPJ ("Tentar de novo").
  documentos text[],
  status text not null default 'pendente',
  solicitado_por uuid not null references profiles(id),
  solicitado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  progresso_atual integer,
  progresso_total integer,
  -- Execução registrada por POST /api/integracoes/iss/execucoes quando a solicitação conclui.
  execucao_id uuid references iss_execucoes_agente(id),
  mensagem_erro text,
  maquina text,
  -- Atualizado pelo agente a cada empresa: parado há mais de 10 min = agente caiu no meio.
  heartbeat_em timestamptz
);

alter table iss_solicitacoes drop constraint if exists chk_iss_solicitacoes_competencia;
alter table iss_solicitacoes add constraint chk_iss_solicitacoes_competencia
  check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

alter table iss_solicitacoes drop constraint if exists chk_iss_solicitacoes_status;
alter table iss_solicitacoes add constraint chk_iss_solicitacoes_status
  check (status in ('pendente', 'em_andamento', 'concluida', 'falhou', 'cancelada'));

-- ============================================================================
-- 2. Índices
-- ============================================================================
-- Barreira REAL contra duas solicitações ativas na mesma competência (mesma técnica de
-- `uq_boletos_resultado_ativo`, migration 0037): a corrida morre no Postgres com 23505, e a rota
-- devolve a solicitação que já existe. Vale também para "Tentar de novo" de uma empresa só.
create unique index if not exists uq_iss_solicitacoes_competencia_ativa
  on iss_solicitacoes (competencia)
  where status in ('pendente', 'em_andamento');

create index if not exists idx_iss_solicitacoes_competencia
  on iss_solicitacoes (competencia, solicitado_em desc);

-- Apoio à consulta "próxima solicitação" do agente (pendente mais antiga).
create index if not exists idx_iss_solicitacoes_pendentes
  on iss_solicitacoes (solicitado_em)
  where status = 'pendente';

-- ============================================================================
-- 3. Idempotência do envio de execuções (QA 13.4/13.5)
-- ============================================================================
-- O agente reenvia sozinho uma execução cujo envio falhou (Story 13.4). Se o servidor GRAVOU mas a
-- resposta se perdeu no caminho, o reenvio duplicaria execução e capturas. O agente passa a mandar
-- uma chave gerada uma vez por execução; a mesma chave de novo devolve a execução já gravada.
-- Execuções antigas (e JSONs antigos reenviados) não têm chave: continuam aceitas como antes.
alter table iss_execucoes_agente add column if not exists chave_idempotencia uuid;

create unique index if not exists uq_iss_execucoes_agente_chave
  on iss_execucoes_agente (chave_idempotencia)
  where chave_idempotencia is not null;

comment on table iss_solicitacoes is
  'Pedidos de busca no ISS Fortaleza feitos pelo sistema web e executados pelo agente local (Story 13.5, Épico 13).';

-- ============================================================================
-- RLS — leitura para os papéis do diálogo de lote (admin, colaborador, financeiro — os mesmos
-- de `requireRole` em propostas-iss/route.ts); escrita só via service role nas rotas novas
-- (mesmo padrão da 0038/0061).
-- ============================================================================
alter table iss_solicitacoes enable row level security;

drop policy if exists iss_solicitacoes_select on iss_solicitacoes;
create policy iss_solicitacoes_select on iss_solicitacoes
  for select using (
    auth.uid() in (select id from profiles where papel in ('admin', 'colaborador', 'financeiro'))
  );

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop index if exists uq_iss_execucoes_agente_chave;
-- alter table iss_execucoes_agente drop column if exists chave_idempotencia;
-- drop policy if exists iss_solicitacoes_select on iss_solicitacoes;
-- drop index if exists idx_iss_solicitacoes_pendentes;
-- drop index if exists idx_iss_solicitacoes_competencia;
-- drop index if exists uq_iss_solicitacoes_competencia_ativa;
-- drop table if exists iss_solicitacoes;
