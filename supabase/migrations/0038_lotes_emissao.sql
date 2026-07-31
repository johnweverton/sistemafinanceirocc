-- Migration 0038 — emissão de boletos em lote (revisão de arquitetura 2026-07-31, decisão 5).
-- Tabelas NOVAS, não reaproveita `execucoes`/`execucao_resultados.status`: execução é CÁLCULO,
-- lote é EMISSÃO — semânticas diferentes, mesma disciplina de isolamento já usada em
-- `processarExecucaoEmpresa` (branch isolado, comentado como "a ÚNICA leitura de
-- execucao.empresaId em todo o orquestrador").
--
-- Fluxo (ver emissao-lote-orchestrator.ts):
--   1. Preview (síncrono, só leitura) → grava aqui com status 'aguardando_confirmacao' e os
--      valores da emissão CONGELADOS (valor_snapshot, conta_emissora) — a confirmação revalida
--      esse snapshot antes de processar (se algo mudou nesse meio-tempo, 409 e novo preview).
--   2. Confirmar (síncrono, 1 clique) → 'processando', dispara o primeiro lote fire-and-forget.
--   3. Processar (assíncrono, encadeado, interno) → item a item, concorrência limitada.
--   4. 'concluido' ou 'pausado_por_falhas' (circuit breaker — ver orquestrador).
--
-- Segurança/idempotência: a barreira REAL contra emissão duplicada continua sendo o índice
-- único parcial de `boletos` (migration 0037) — não depende de nada aqui. Por isso NÃO há
-- índice único cross-lote em `lote_emissao_itens` (ex.: impedir 2 lotes com o mesmo resultado
-- 'pendente' ao mesmo tempo): o pior caso sem ele é dois lotes tentarem processar o mesmo item,
-- e o segundo simplesmente recebe 409 BOLETO_JA_EMITIDO do `reservarBoleto` e marca o item como
-- 'pulado' — nunca dois boletos reais. Evita a complexidade de expirar/liberar itens travados
-- por um lote nunca confirmado.

create table lotes_emissao (
  id uuid primary key default gen_random_uuid(),
  -- 'execucao': escopo_ref = execucoes.id (única implementada por ora — UI em RelatorioGrupos).
  -- 'competencia' fica reservado no CHECK para uma extensão futura (ainda sem código que a crie).
  escopo_tipo text not null check (escopo_tipo in ('execucao', 'competencia')),
  escopo_ref text not null,
  status text not null check (status in (
    'aguardando_confirmacao', 'processando', 'pausado_por_falhas', 'concluido', 'cancelado', 'expirado'
  )) default 'aguardando_confirmacao',
  criado_por uuid not null references profiles(id),
  criado_em timestamptz not null default now(),
  confirmado_por uuid references profiles(id),
  confirmado_em timestamptz,
  finalizado_em timestamptz,
  -- Snapshot mostrado no preview — a confirmação revalida contra isto (Fase B do orquestrador).
  snapshot_total_itens integer not null,
  snapshot_total_valor numeric(12,2) not null,
  progresso integer not null default 0,
  -- Circuit breaker persistido (não em memória — o lote atravessa múltiplas invocações
  -- serverless). Motivo textual de pausa para a UI explicar ao operador o que aconteceu.
  falhas_consecutivas integer not null default 0,
  motivo_pausa text,
  total_emitidos integer not null default 0,
  total_pulados integer not null default 0,
  total_falhas integer not null default 0,
  total_valor_emitido numeric(12,2) not null default 0
);

create table lote_emissao_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references lotes_emissao(id),
  execucao_resultado_id uuid not null references execucao_resultados(id),
  -- Nullable: um item RECUSADO no preview (ex.: resultado sem pagador vinculado) pode não ter
  -- conta emissora resolvida — ainda assim entra na tabela com o motivo, pra não sumir da tela.
  conta_emissora text check (conta_emissora in ('mc', 'cavalcante_viana')),
  valor_snapshot numeric(10,2) not null,
  status text not null check (status in ('pendente', 'emitido', 'pulado', 'falha')) default 'pendente',
  codigo_erro text,
  mensagem_erro text,
  boleto_id uuid references boletos(id),
  processado_em timestamptz
);

alter table boletos add column if not exists lote_id uuid references lotes_emissao(id);

create index idx_lote_emissao_itens_lote on lote_emissao_itens (lote_id);
create index idx_lote_emissao_itens_lote_status on lote_emissao_itens (lote_id, status);
create index idx_lotes_emissao_escopo on lotes_emissao (escopo_tipo, escopo_ref);

alter table lotes_emissao enable row level security;
alter table lote_emissao_itens enable row level security;

create policy "Leitura de lotes de emissao para admin e financeiro"
  on lotes_emissao for select
  using (
    auth.uid() in (select id from profiles where papel in ('admin', 'financeiro'))
  );

create policy "Leitura de itens de lote de emissao para admin e financeiro"
  on lote_emissao_itens for select
  using (
    auth.uid() in (select id from profiles where papel in ('admin', 'financeiro'))
  );

-- Insert/update/delete só via service role (server-side) — sem policy de escrita para clientes
-- (mesmo padrão de boletos, migration 0004).

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table boletos drop column if exists lote_id;
-- drop table if exists lote_emissao_itens;
-- drop table if exists lotes_emissao;
