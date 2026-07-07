-- Migration 0014 — revisão manual de resultados em alerta.
-- Motivo: um ExecucaoResultado com status 'alerta' (ex.: variação alta de guias, modo inconsistente,
-- dado incompleto) nunca tinha caminho de saída — não existia nenhum UPDATE em execucao_resultados
-- em todo o código, então o registro ficava travado para sempre e nunca podia ser emitido (a rota
-- POST /api/boletos/emitir só aceita status='ok'). Esta migration adiciona as colunas de auditoria
-- necessárias para um operador (admin/financeiro) revisar o alerta e liberar o resultado para 'ok'.
--
-- IMPORTANTE (mesma observação de todas as migrations deste projeto): entregue pelo dev, aplicada
-- MANUALMENTE pelo dono via SQL editor do Supabase Studio ou `supabase db push`.

alter table execucao_resultados
  add column if not exists status_original text,
  add column if not exists revisado_por uuid references profiles(id),
  add column if not exists revisado_em timestamptz,
  add column if not exists motivo_revisao text;

comment on column execucao_resultados.status_original is
  'Status computado originalmente pelo engine, preservado quando o resultado é revisado manualmente (status_original = ''alerta'' e status atual = ''ok'' → liberado por revisão humana, não pelo cálculo).';
comment on column execucao_resultados.revisado_por is
  'profiles.id de quem revisou e liberou o alerta (mesma trava de quem emite boleto: admin/financeiro).';
comment on column execucao_resultados.motivo_revisao is
  'Justificativa obrigatória informada na revisão — auditoria de por que um alerta de negócio foi liberado para cobrança.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table execucao_resultados
--   drop column if exists status_original,
--   drop column if exists revisado_por,
--   drop column if exists revisado_em,
--   drop column if exists motivo_revisao;
