-- Migration 0041 — recálculo manual de um resultado já gravado.
-- Motivo (achado real 2026-08-04, Dr. José Neias): quando o dado de origem é corrigido DEPOIS
-- que a execução já rodou (ex.: hospital corrige uma senha/atendimento duplicado no Sistema Web),
-- não existia nenhuma forma de atualizar o resultado sem criar uma execução inteira nova. Esta
-- migration adiciona as colunas de auditoria para o recálculo em cima da MESMA linha de
-- execucao_resultados (mesmo espírito de `revisado_por`/`revisado_em`, migration 0014).
--
-- IMPORTANTE (mesma observação de todas as migrations deste projeto): entregue pelo dev, aplicada
-- MANUALMENTE pelo dono via SQL editor do Supabase Studio ou `supabase db push`.

alter table execucao_resultados
  add column if not exists recalculado_por uuid references profiles(id),
  add column if not exists recalculado_em timestamptz;

comment on column execucao_resultados.recalculado_por is
  'profiles.id de quem disparou o recálculo (mesma trava de quem revisa/emite: admin/financeiro). Recalcular só é permitido enquanto nenhum boleto ativo existir para o resultado.';
comment on column execucao_resultados.recalculado_em is
  'Quando o resultado foi recalculado pela última vez, reprocessando os itens de produção atuais da origem.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_resultados
--   drop column if exists recalculado_por,
--   drop column if exists recalculado_em;
