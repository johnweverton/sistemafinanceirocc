-- Migration 0047 — relatorio_links (Módulo de Relatórios: link público do BI).
--
-- Token de acesso ao BI interativo (/relatorios/publico/[token]) sem exigir login da CEO —
-- ela recebia manualmente uma planilha por e-mail/WhatsApp; agora acompanha via um link.
--
-- Diferente do secret do webhook Cora (migrations 0004/0007, comparado em tempo constante
-- contra um conjunto pequeno e fixo de segredos): aqui o token É o identificador (índice
-- único), gerado com 256 bits de entropia (crypto.randomBytes(32) em base64url, ~43 chars,
-- server-side em relatorio-links-repository.ts) e guardado em texto puro — a UI de gestão
-- precisa reexibir/copiar o link depois de criado, não só no instante da criação. A defesa
-- real é a entropia (impraticável adivinhar/enumerar) + revogação manual, não uma
-- comparação tipo senha.
--
-- O BI público NUNCA expõe dado linha-a-linha (nome de médico, boletoId, id_externo Cora):
-- lê exclusivamente das views agregadas do dashboard (vw_dashboard_competencia, via
-- dashboard-repository.ts), nunca de vw_recebiveis. Por isso este schema não tem nenhuma
-- flag "mostrar nome" — a fonte de dado já garante que não há nome no payload público.
--
-- escopo_conta_emissora (nullable): quando preenchido, restringe o BI àquela conta
-- (empresa Cora); null = consolidado das 4 contas.
--
-- RLS habilitada por defesa em profundidade (padrão 0002/0004/0007): a aplicação sempre
-- acessa esta tabela via service role (repository), tanto nas rotas autenticadas quanto na
-- pública (que não tem sessão Supabase alguma) — RLS aqui é um backstop caso alguma rota
-- use por engano o client autenticado comum.
--
-- Aditiva/idempotente. Rollback comentado no rodapé.

create table if not exists relatorio_links (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  nome text not null,
  escopo_conta_emissora text
    check (escopo_conta_emissora is null or escopo_conta_emissora in ('mc', 'cavalcante_viana', 'carmem_cavalcante', 'cc_solucoes')),
  criado_por uuid not null references profiles(id),
  criado_em timestamptz not null default now(),
  expira_em timestamptz,
  revogado_em timestamptz,
  ultimo_acesso_em timestamptz,
  ultimo_acesso_ip text
);

create unique index if not exists uq_relatorio_links_token on relatorio_links (token);

comment on table relatorio_links is
  'Links públicos (token opaco de alta entropia) de acesso ao BI de Relatórios, sem exigir login. Fonte de dados do BI é sempre agregada (vw_dashboard_*), nunca linha-a-linha.';
comment on column relatorio_links.token is
  'Bearer token (256 bits, crypto.randomBytes em relatorio-links-repository.ts). Posse do token = acesso, como uma API key.';
comment on column relatorio_links.escopo_conta_emissora is
  'Restringe o BI a uma única conta emissora (empresa); null = consolidado das 4 contas.';
comment on column relatorio_links.revogado_em is
  'Não-nulo = link revogado manualmente; tratar como inválido junto com expira_em vencido.';

alter table relatorio_links enable row level security;

create policy relatorio_links_select_admin_financeiro on relatorio_links for select using (
  exists (select 1 from profiles where id = auth.uid() and papel in ('admin', 'financeiro'))
);

create policy relatorio_links_write_admin_financeiro on relatorio_links for all using (
  exists (select 1 from profiles where id = auth.uid() and papel in ('admin', 'financeiro'))
);

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop table if exists relatorio_links;
