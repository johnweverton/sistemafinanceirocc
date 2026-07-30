-- Migration 0036 — Categorias adicionais no Plano de Contas (pós-Épico 8/9).
-- Origem: skill externa de contabilidade `analisar-extrato-bancario` (NBC TG 1000/03),
-- revisada e aprovada pelo dono do produto — melhoria 1 de 3 do pacote de conciliação
-- bancária (ver também: alerta de saldo negativo no dashboard e bloco de conciliação
-- formal em /extrato, sem migration associada).
--
-- Objetivo: o seed da 0023 não distinguia naturezas de caixa comuns (aporte/retirada de
-- sócio, empréstimos, obrigações trabalhistas/tributárias) — hoje caem genericamente em
-- "Despesas administrativas" ou ficam sem categoria de sistema nenhuma. Todas as linhas
-- abaixo são NÃO-sistema (sistema=false), editáveis pelo usuário como qualquer categoria
-- comum — não mexe nas 2 categorias protegidas (Receita de honorários / Tarifas
-- bancárias) nem no mecanismo de auto-categorização (9.2).
--
-- Aditiva e idempotente: mesmo padrão da 0023 (ON CONFLICT no UNIQUE (grupo, nome)).
-- Não altera o CHECK de `grupo` (chk_plano_contas_grupo) — permanece
-- ('receita', 'deducao_receita', 'despesa_operacional', 'despesa_financeira').
--
-- Decisão de grupo (registrada aqui para o dono revisar — nenhuma delas é 100% exata,
-- porque o schema atual não tem um grupo "fora do resultado do DRE"; o relatório
-- (relatorio-dre.ts) soma QUALQUER categoria do grupo `receita` em totalReceitas e
-- QUALQUER categoria de `despesa_financeira` em totalDespesasFinanceiras — ou seja,
-- transações reais categorizadas como "Aporte de capital"/"Capital social"/empréstimos
-- VÃO inflar receita, e "Retiradas de sócio"/"Dividendos" VÃO inflar despesa financeira
-- no resultadoLiquido, mesmo não sendo receita/despesa operacional de verdade. Isso é uma
-- limitação conhecida do schema atual (só 4 grupos, todos entram na fórmula do DRE) e foi
-- aceita conscientemente para não inventar grupo novo nem alterar o CHECK/engine agora;
-- uma story futura pode adicionar um eixo "fora do resultado" se o uso real mostrar que
-- isso distorce o relatório na prática):
--   - Aporte de capital / Capital social / Empréstimos a pagar / Empréstimos recebidos:
--     todos são ENTRADA de caixa não-operacional (aporte de sócio ou proventos de
--     empréstimo) — grupo `receita` é o único grupo de ENTRADA disponível no CHECK.
--   - Retiradas de sócio / Dividendos: SAÍDA de caixa para o sócio, de natureza
--     financeira/societária (não é custo operacional do negócio) — `despesa_financeira`
--     é o grupo de saída mais próximo semanticamente (junto de "Juros e outras taxas").
--   - INSS/FGTS/IRRF a recolher: obrigação trabalhista/tributária ligada à folha —
--     `despesa_operacional`, ao lado de "Despesas com pessoal" (mesma origem: folha).
--   - DAS / Simples Nacional: imposto calculado sobre a receita bruta, mesma natureza de
--     "Impostos sobre serviços" já seedado — `deducao_receita`.
insert into plano_contas (grupo, nome, sistema, ordem) values
  ('receita', 'Aporte de capital', false, 1),
  ('receita', 'Empréstimos a pagar', false, 2),
  ('receita', 'Empréstimos recebidos', false, 3),
  ('receita', 'Capital social', false, 4),
  ('deducao_receita', 'DAS / Simples Nacional', false, 2),
  ('despesa_operacional', 'INSS/FGTS/IRRF a recolher', false, 3),
  ('despesa_financeira', 'Retiradas de sócio', false, 1),
  ('despesa_financeira', 'Dividendos', false, 2)
on conflict (grupo, nome) do nothing;

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- delete from plano_contas where sistema = false and (grupo, nome) in (
--   ('receita', 'Aporte de capital'),
--   ('receita', 'Empréstimos a pagar'),
--   ('receita', 'Empréstimos recebidos'),
--   ('receita', 'Capital social'),
--   ('deducao_receita', 'DAS / Simples Nacional'),
--   ('despesa_operacional', 'INSS/FGTS/IRRF a recolher'),
--   ('despesa_financeira', 'Retiradas de sócio'),
--   ('despesa_financeira', 'Dividendos')
-- );
