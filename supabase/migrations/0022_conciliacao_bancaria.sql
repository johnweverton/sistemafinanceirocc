-- Migration 0022 — conciliação bancária (Story 8.1, Épico 8).
-- Snapshot do extrato da Cora por conta emissora (D1) + log de sincronizações.
-- Fonte: docs/architecture/feature-conciliacao-bancaria.md §3 (aprovada pelo dono 2026-07-10).
--
-- Decisões refletidas aqui:
--   - D1: extrato persistido no Supabase — conciliação exige ESTADO por transação
--     (sem_match/sugerido/conciliado_*/ignorado); a página e o dashboard leem do banco.
--   - Idempotência do sync: UNIQUE (conta_emissora, entry_id) — re-sincronizar um período
--     atualiza os dados bancários sem duplicar nem regredir o status de conciliação
--     (o upsert do repositório NUNCA escreve as colunas de conciliação).
--   - 1 boleto ↔ no máximo 1 transação conciliada: UNIQUE parcial em boleto_id restrito
--     aos status 'conciliado_%' (sugestões podem apontar para o mesmo boleto; conciliação não).
--   - Trilha reversível: conciliado_por/conciliado_em registram quem/quando (null em
--     conciliado_auto — ação do sistema); desfazer limpa tudo.
--
-- Aditiva e idempotente: create table/index if not exists + CHECKs e policies com
-- drop/add nomeado (padrão 0018/0021). RLS espelha boletos (0004): leitura admin/financeiro,
-- escrita só via service role.

create table if not exists extrato_transacoes (
  id uuid primary key default gen_random_uuid(),
  conta_emissora text not null,
  entry_id text not null,              -- id da entrada no extrato da Cora
  tipo text not null,                  -- CREDIT | DEBIT
  transaction_type text,               -- TRANSFER | PAYMENT | PIX | FEE (cru da API)
  valor numeric(12,2) not null,        -- em REAIS — convertido de centavos na borda (mapper)
  descricao text,
  contraparte_nome text,
  contraparte_documento text,          -- dígitos; chave da camada 1 do matching (8.2)
  data_transacao timestamptz not null,
  status_conciliacao text not null default 'sem_match',
  boleto_id uuid references boletos(id),
  conciliado_por uuid references profiles(id),  -- null em conciliado_auto (ação do sistema)
  conciliado_em timestamptz,
  payload jsonb,                       -- entrada crua da API (auditoria, padrão do projeto)
  sincronizado_em timestamptz not null default now()
);

alter table extrato_transacoes drop constraint if exists chk_extrato_conta_emissora;
alter table extrato_transacoes add constraint chk_extrato_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana'));

alter table extrato_transacoes drop constraint if exists chk_extrato_tipo;
alter table extrato_transacoes add constraint chk_extrato_tipo
  check (tipo in ('CREDIT', 'DEBIT'));

alter table extrato_transacoes drop constraint if exists chk_extrato_status_conciliacao;
alter table extrato_transacoes add constraint chk_extrato_status_conciliacao
  check (status_conciliacao in ('sem_match', 'sugerido', 'conciliado_auto', 'conciliado_manual', 'ignorado'));

-- Idempotência do sync (alvo do ON CONFLICT do upsert).
create unique index if not exists uq_extrato_conta_entry
  on extrato_transacoes (conta_emissora, entry_id);

-- 1 boleto ↔ 1 transação CONCILIADA (sugestões não travam o boleto).
create unique index if not exists uq_extrato_boleto_conciliado
  on extrato_transacoes (boleto_id)
  where status_conciliacao like 'conciliado%';

create index if not exists idx_extrato_conta_data
  on extrato_transacoes (conta_emissora, data_transacao);

create index if not exists idx_extrato_status
  on extrato_transacoes (status_conciliacao);

comment on table extrato_transacoes is
  'Snapshot do extrato bancário da Cora por conta emissora (Épico 8, D1). O sync faz upsert por (conta_emissora, entry_id); o estado de conciliação vive AQUI e nunca é sobrescrito pelo sync.';
comment on column extrato_transacoes.valor is
  'Valor em REAIS (positivo). A API da Cora devolve centavos — a conversão acontece no mapper do gateway, nunca no banco.';
comment on column extrato_transacoes.contraparte_documento is
  'CPF/CNPJ da contraparte (só dígitos). Camada 1 do matching (8.2): auto-conciliação exige este documento = pagador_documento do médico.';
comment on column extrato_transacoes.status_conciliacao is
  'Estado da conciliação (D2): sem_match | sugerido | conciliado_auto | conciliado_manual | ignorado. Transições sempre com trilha e reversíveis.';
comment on column extrato_transacoes.conciliado_por is
  'Quem conciliou/ignorou (profiles.id); null quando a ação foi do sistema (conciliado_auto).';

-- ============================================================================
-- extrato_syncs — log de sincronizações (auditoria e janela do próximo sync).
-- ============================================================================
create table if not exists extrato_syncs (
  id uuid primary key default gen_random_uuid(),
  conta_emissora text not null,
  periodo_inicio date not null,
  periodo_fim date not null,
  qtd_novas integer not null default 0,
  qtd_atualizadas integer not null default 0,
  executado_por uuid references profiles(id),
  executado_em timestamptz not null default now()
);

alter table extrato_syncs drop constraint if exists chk_extrato_syncs_conta_emissora;
alter table extrato_syncs add constraint chk_extrato_syncs_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana'));

create index if not exists idx_extrato_syncs_conta_executado
  on extrato_syncs (conta_emissora, executado_em);

comment on table extrato_syncs is
  'Log de sincronizações do extrato (Épico 8, D3 — sob demanda na v1). O último executado_em por conta define a janela do próximo sync (com overlap de 3 dias).';

-- ============================================================================
-- RLS — espelha boletos (0004): leitura admin/financeiro; escrita só service role.
-- ============================================================================
alter table extrato_transacoes enable row level security;

drop policy if exists "Leitura de extrato para admin e financeiro" on extrato_transacoes;
create policy "Leitura de extrato para admin e financeiro"
  on extrato_transacoes for select
  using (
    auth.uid() in (
      select id from profiles where papel in ('admin', 'financeiro')
    )
  );

alter table extrato_syncs enable row level security;

drop policy if exists "Leitura de syncs de extrato para admin e financeiro" on extrato_syncs;
create policy "Leitura de syncs de extrato para admin e financeiro"
  on extrato_syncs for select
  using (
    auth.uid() in (
      select id from profiles where papel in ('admin', 'financeiro')
    )
  );

-- Insert/update/delete só via service role (server-side) — sem policy de escrita para clientes.

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop policy if exists "Leitura de syncs de extrato para admin e financeiro" on extrato_syncs;
-- drop policy if exists "Leitura de extrato para admin e financeiro" on extrato_transacoes;
-- drop table if exists extrato_syncs;
-- drop table if exists extrato_transacoes;
