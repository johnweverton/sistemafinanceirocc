-- Migration 0019 — coluna whatsapp em medicos (bloco de cobrança).
-- Contexto: o campo `whatsapp` do bloco de cobrança sempre existiu no tipo DadosCobranca e no
-- formulário de cadastro, mas nunca teve coluna no banco nem validação no schema Zod — era
-- descartado silenciosamente ao salvar. Corrigido junto com a revisão dos requisitos mínimos
-- de emissão (Épico 6): "cadastro completo" passa a exigir e-mail + whatsapp (endereço deixou
-- de ser obrigatório, pois a Cora não exige para emitir boleto registrado).
--
-- Segurança: aditivo e nullable (zero downtime). Idempotente.

alter table medicos
  add column if not exists whatsapp text;

comment on column medicos.whatsapp is 'Número ou ID de grupo do WhatsApp do pagador, usado para disparo automático do boleto.';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- alter table medicos drop column if exists whatsapp;
