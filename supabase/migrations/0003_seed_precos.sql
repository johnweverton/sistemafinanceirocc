-- Migration 0003 — seed da tabela de preços com os valores atuais do PRD §5.1.
-- Estes valores são editáveis sem deploy (são linhas, não código). O Engine usa
-- TABELA_PRECO_PADRAO como default; em produção a tabela é carregada daqui.
-- regra_excedente: 'por_guia:6.00' = soma R$6,00 por guia acima do último teto;
--                  'fixo'          = valor fixo da própria linha acima do último teto.

-- HAPVIDA NÃO CREDENCIADO
insert into precos (classe, teto_guias, valor, regra_excedente, ordem) values
  ('HAPVIDA_NAO_CRED', 30,  310.06, null,            1),
  ('HAPVIDA_NAO_CRED', 50,  465.07, null,            2),
  ('HAPVIDA_NAO_CRED', 80,  697.71, null,            3),
  ('HAPVIDA_NAO_CRED', 150, 852.84, null,            4),
  ('HAPVIDA_NAO_CRED', 180, 1090.16,'por_guia:6.00', 5);

-- HAPVIDA CREDENCIADO
insert into precos (classe, teto_guias, valor, regra_excedente, ordem) values
  ('HAPVIDA_CRED', 30,  263.59, null,            1),
  ('HAPVIDA_CRED', 50,  394.12, null,            2),
  ('HAPVIDA_CRED', 80,  697.71, null,            3),
  ('HAPVIDA_CRED', 150, 775.33, null,            4),
  ('HAPVIDA_CRED', 180, 950.89, 'por_guia:6.00', 5);

-- OUTROS HOSPITAIS — acima de 80 NÃO definido (PRD §11): sem linha de excedente.
insert into precos (classe, teto_guias, valor, regra_excedente, ordem) values
  ('OUTROS_HOSPITAIS', 30, 172.20, null, 1),
  ('OUTROS_HOSPITAIS', 50, 258.30, null, 2),
  ('OUTROS_HOSPITAIS', 80, 367.36, null, 3);

-- IMOBILIZAÇÕES — acima de 150 = valor fixo.
insert into precos (classe, teto_guias, valor, regra_excedente, ordem) values
  ('IMOBILIZACOES', 50,  73.65,  null,   1),
  ('IMOBILIZACOES', 100, 132.65, null,   2),
  ('IMOBILIZACOES', 150, 186.10, null,   3),
  ('IMOBILIZACOES', null,387.78, 'fixo', 4);
