-- Migration 0024 — Story 10.3: OUTROS_HOSPITAIS acima de 80 guias cobra o teto fixo.
-- Revisão consciente do PRD §11 (decisão do dono, 2026-07-20): a planilha manual da
-- coordenação sempre capou no teto da faixa (R$367,36) acima de 80 guias, em vez de travar
-- em "FORA DA TABELA". Evidência: Dr. Anderson Ferreira, abr/2026 — 118 outros hospitais →
-- R$367,36 (parte do total 677,42 = 310,06 Hapvida não-cred + 367,36 outros hospitais).
--
-- Mesmo padrão da linha de excedente de IMOBILIZACOES (migration 0003): uma linha extra com
-- teto_guias = null representa a regra de excedente acima do último teto real.
-- Esta tabela `precos` ainda não é lida em runtime pelo app (o Engine usa TABELA_PRECO_PADRAO
-- em precos.ts como fonte de verdade — ver comentário no topo do arquivo); a migration mantém
-- a tabela coerente com o Engine para quando a leitura via Supabase for implementada.

insert into precos (classe, teto_guias, valor, regra_excedente, ordem) values
  ('OUTROS_HOSPITAIS', null, 367.36, 'fixo', 4);

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- delete from precos where classe = 'OUTROS_HOSPITAIS' and teto_guias is null and regra_excedente = 'fixo';
