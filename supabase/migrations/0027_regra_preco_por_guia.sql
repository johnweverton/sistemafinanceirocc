-- Migration 0027 — reincluir forma 'por_guia' na regra de preço própria (Story 10.1).
-- Dr. Ezequiel tinha ficado FORA do override automático (Change Log 0.2 da story: taxa
-- parecia mudar mês a mês — R$4,00/guia em mai-jun, valores com sufixo ",89" em fev-abr).
-- O dono confirmou em 2026-07-20 que R$4,00/guia é a taxa ESTÁVEL e atual — Ezequiel entra
-- no automático com a mesma forma "por guia linear" que a Nefrologia usaria (Story 10.4,
-- mas lá é agrupamento por empresa; aqui é override individual de médico, mesmo mecanismo
-- de dados já criado na migration 0025 — só a CHECK de forma precisa aceitar 'por_guia').
--
-- Backfill: nenhum médico existente muda de comportamento (a forma só é lida quando
-- modo_cobranca = 'preco_proprio' E regra_preco_forma = 'por_guia' — nenhuma linha hoje
-- satisfaz isso). Idempotente: drop+add de CHECK nomeada. Rollback no rodapé.

alter table medicos drop constraint if exists chk_medicos_regra_preco_forma;
alter table medicos add constraint chk_medicos_regra_preco_forma
  check (regra_preco_forma is null or regra_preco_forma in ('por_guia', 'base_excedente', 'fixo'));

alter table medicos drop constraint if exists chk_medicos_regra_preco_coerente;
alter table medicos add constraint chk_medicos_regra_preco_coerente
  check (
    modo_cobranca <> 'preco_proprio'
    or (
      regra_preco_forma = 'por_guia'
      and regra_preco_taxa is not null
    )
    or (
      regra_preco_forma = 'base_excedente'
      and regra_preco_base is not null
      and regra_preco_limiar is not null
      and regra_preco_taxa is not null
    )
    or (
      regra_preco_forma = 'fixo'
      and regra_preco_valor_fixo is not null
    )
  );

comment on column medicos.regra_preco_forma is
  'Forma da regra de preço própria (Story 10.1): por_guia, base_excedente ou fixo. Null = sem override (segue faixa_guias/percentual_producao).';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table medicos drop constraint if exists chk_medicos_regra_preco_coerente;
-- alter table medicos add constraint chk_medicos_regra_preco_coerente
--   check (
--     modo_cobranca <> 'preco_proprio'
--     or (regra_preco_forma = 'base_excedente' and regra_preco_base is not null and regra_preco_limiar is not null and regra_preco_taxa is not null)
--     or (regra_preco_forma = 'fixo' and regra_preco_valor_fixo is not null)
--   );
-- alter table medicos drop constraint if exists chk_medicos_regra_preco_forma;
-- alter table medicos add constraint chk_medicos_regra_preco_forma
--   check (regra_preco_forma is null or regra_preco_forma in ('base_excedente', 'fixo'));
