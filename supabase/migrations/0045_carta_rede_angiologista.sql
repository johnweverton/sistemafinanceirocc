-- Migration 0045 — Carta de Rede do médico Angiologista, contagem MANUAL (GATE 2026-08-12).
-- Mesmo padrão da 0044 (Cateter/Fístula/Angiografia): produção separada e OPCIONAL na MESMA linha
-- de execucao_selecoes (preserva o UNIQUE execucao_id+medico_id da migration 0011).
--
-- Diferença dos outros 3 lotes do Angiologista: Carta de Rede NÃO tem regra de contagem fixa —
-- confirmado pela coordenadora, a contagem de guias depende de qual procedimento foi realizado
-- naquele mês, "foge de um padrão" que dê pra automatizar via fórmula (1x1, 3x1 etc.). Por isso
-- não buscamos itens da API externa pra essa Carta de Rede: o operador digita a quantidade de
-- guias diretamente (`carta_rede_guias`), e essa contagem entra na MESMA faixa HAPVIDA padrão do
-- médico junto com Cateter+Fístula+Angiografia (não é uma classe/tabela de preço própria — mesmo
-- tratamento que os outros 3 lotes já recebem, confirmado pelo dono).
--
-- `producao_carta_rede_externa_id`/`nome` são só um snapshot de referência/auditoria (qual produção
-- de origem, ex. "SAMANTA CARTA DE REDE", gerou aquele número) — NÃO são lidos pelo Engine, que usa
-- só `carta_rede_guias`. `carta_rede_informado_por`/`_em` seguem o mesmo padrão de auditoria de
-- número digitado manualmente já usado em `clientes_contabilidade_faturamentos.informado_por/_em`
-- (migration 0031).

alter table execucao_selecoes
  add column if not exists producao_carta_rede_externa_id text,
  add column if not exists producao_carta_rede_nome text,
  add column if not exists carta_rede_guias integer,
  add column if not exists carta_rede_informado_por uuid references profiles(id),
  add column if not exists carta_rede_informado_em timestamptz;

alter table execucao_selecoes drop constraint if exists chk_execucao_selecoes_carta_rede_guias;
alter table execucao_selecoes add constraint chk_execucao_selecoes_carta_rede_guias
  check (carta_rede_guias is null or carta_rede_guias >= 0);

comment on column execucao_selecoes.producao_carta_rede_externa_id is
  'Produção de origem (fin-producoes.id) usada só como REFERÊNCIA/AUDITORIA de qual lote (ex.: "SAMANTA CARTA DE REDE") gerou o número digitado em carta_rede_guias — o Engine NUNCA busca itens dela nem calcula a partir dela.';
comment on column execucao_selecoes.producao_carta_rede_nome is
  'Snapshot do nome da produção de referência exibido na escolha (mesmo padrão de producao_nome).';
comment on column execucao_selecoes.carta_rede_guias is
  'Quantidade de guias de Carta de Rede informada MANUALMENTE pelo operador (sem fórmula — GATE 2026-08-12). Null = lote não informado nesta execução — o motor gera alerta e NÃO cobra (nunca reaproveita outro lote). Soma com Cateter+Fístula+Angiografia na mesma faixa HAPVIDA do médico.';
comment on column execucao_selecoes.carta_rede_informado_por is
  'profiles.id de quem digitou carta_rede_guias — mesmo padrão de auditoria de clientes_contabilidade_faturamentos.informado_por.';
comment on column execucao_selecoes.carta_rede_informado_em is
  'Timestamp de quando carta_rede_guias foi informado.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_selecoes
--   drop constraint if exists chk_execucao_selecoes_carta_rede_guias,
--   drop column if exists producao_carta_rede_externa_id,
--   drop column if exists producao_carta_rede_nome,
--   drop column if exists carta_rede_guias,
--   drop column if exists carta_rede_informado_por,
--   drop column if exists carta_rede_informado_em;
