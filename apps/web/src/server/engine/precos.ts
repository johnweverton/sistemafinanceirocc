// Motor de preço — porte 1:1 de motor_guias_v2.py (TABELAS, valor_da_faixa).
// PRD §5.1. Função pura, sem I/O. A tabela é parâmetro injetado (editável sem deploy).
import type { Classe, TabelaPreco, TabelaPrecoClasse, ResultadoFaixa } from '@cobranca/shared';

/**
 * Tabela de preço padrão — valores atuais do PRD §5.1.
 * Em produção, esta tabela vem da tabela `precos` do Supabase (editável sem deploy).
 * Mantida aqui como default/seed e para os testes de regressão do Engine.
 *
 * NOTA (PRD §11 — revisado pelo dono em 2026-07-14, Story 10.3): OUTROS_HOSPITAIS acima de
 * 80 guias cobra o teto da faixa (R$367,36) fixo, sem excedente por guia. Antes disso o motor
 * devolvia null + "FORA DA TABELA"; a planilha manual da coordenação sempre capou no teto
 * (evidência: Dr. Anderson Ferreira, abr/2026 — 118 outros hospitais → R$367,36).
 */
export const TABELA_PRECO_PADRAO: TabelaPreco = {
  HAPVIDA_NAO_CRED: {
    faixas: [
      { teto: 30, valor: 310.06 },
      { teto: 50, valor: 465.07 },
      { teto: 80, valor: 697.71 },
      { teto: 150, valor: 852.84 },
      { teto: 180, valor: 1090.16 },
    ],
    excedente: { tipo: 'por_guia', valorExcedente: 6.0 },
  },
  HAPVIDA_CRED: {
    faixas: [
      { teto: 30, valor: 263.59 },
      { teto: 50, valor: 394.12 },
      { teto: 80, valor: 697.71 },
      { teto: 150, valor: 775.33 },
      { teto: 180, valor: 950.89 },
    ],
    excedente: { tipo: 'por_guia', valorExcedente: 6.0 },
  },
  OUTROS_HOSPITAIS: {
    faixas: [
      { teto: 30, valor: 172.2 },
      { teto: 50, valor: 258.3 },
      { teto: 80, valor: 367.36 },
    ],
    // Story 10.3: acima de 80, cobra o teto fixo (não extrapola por guia).
    excedente: { tipo: 'fixo', valorFixo: 367.36 },
  },
  IMOBILIZACOES: {
    faixas: [
      { teto: 50, valor: 73.65 },
      { teto: 100, valor: 132.65 },
      { teto: 150, valor: 186.1 },
    ],
    excedente: { tipo: 'fixo', valorFixo: 387.78 }, // acima de 150 = valor fixo
  },
};

/**
 * Valor unitário padrão da consulta ambulatorial de pediatria (Story 10.2). GATE do dono
 * (2026-07-20): R$3,00, global, editável sem deploy — em produção viria de
 * `config_cobranca.valor_consulta_pediatria` (a orquestração injeta o valor lido do banco;
 * o Engine continua puro, recebendo-o como parâmetro, mesmo padrão de `tabela`).
 */
export const VALOR_CONSULTA_PEDIATRIA_PADRAO = 3.0;

/**
 * Aplica a faixa de preço para uma quantidade de guias numa classe.
 * Espelha valor_da_faixa() do Python:
 *   1. primeira faixa cujo teto >= guias → seu valor
 *   2. senão, último teto + regra de excedente (por_guia ou fixo)
 *   3. sem regra → null + "FORA DA TABELA — verificar" (PRD §5.1 outros hospitais > 80)
 */
export function valorDaFaixa(
  tabela: TabelaPrecoClasse,
  guias: number,
): ResultadoFaixa {
  for (const { teto, valor } of tabela.faixas) {
    if (guias <= teto) {
      return { valor, faixa: `até ${teto} guias` };
    }
  }

  const ultima = tabela.faixas[tabela.faixas.length - 1];
  if (!ultima) {
    return { valor: null, faixa: 'FORA DA TABELA — verificar' };
  }

  const ex = tabela.excedente;
  if (ex?.tipo === 'por_guia' && ex.valorExcedente != null) {
    const excedente = guias - ultima.teto;
    return {
      valor: ultima.valor + excedente * ex.valorExcedente,
      faixa: `${ultima.teto}+ (${excedente} × R$${ex.valorExcedente.toFixed(2)})`,
    };
  }
  if (ex?.tipo === 'fixo' && ex.valorFixo != null) {
    return { valor: ex.valorFixo, faixa: `acima de ${ultima.teto} (valor fixo)` };
  }

  return { valor: null, faixa: 'FORA DA TABELA — verificar' };
}

/**
 * Determina as classes de um médico (PRD §5.1, §5.5).
 *
 * PORTE 1:1 de classes_do_medico() do Python (spec executável validada):
 *   - credenciado            → HAPVIDA_CRED
 *   - não credenciado        → HAPVIDA_NAO_CRED  (inclui o ramo `else` do Python)
 *   - outros_hosp            → + OUTROS_HOSPITAIS
 *   - imobilizacao           → + IMOBILIZACOES
 *
 * TODO (PRD §11 — divergência a confirmar com a Carmem):
 *   O PRD §5.1 define TIPO 3 = "somente outros hospitais, sem Hapvida", mas o motor
 *   Python força HAPVIDA_NAO_CRED no ramo `else` (statusHapvida = 'nenhum'). Mantemos
 *   o comportamento do Python por ser a spec validada; NÃO corrigir silenciosamente.
 *   Quando a Carmem confirmar, ajustar este ramo e a regressão correspondente.
 */
export function classesDoMedico(m: {
  statusHapvida: 'credenciado' | 'nao_credenciado' | 'nenhum';
  fazOutrosHospitais: boolean;
  fazImobilizacoes: boolean;
}): Classe[] {
  const classes: Classe[] = [];
  if (m.statusHapvida === 'credenciado') {
    classes.push('HAPVIDA_CRED');
  } else if (m.statusHapvida === 'nao_credenciado' && !m.fazOutrosHospitais) {
    classes.push('HAPVIDA_NAO_CRED');
  } else {
    // Ramo `else` do Python: cobre nao_credenciado+outros e o caso 'nenhum'.
    // Ver TODO §11 acima.
    classes.push('HAPVIDA_NAO_CRED');
  }
  if (m.fazOutrosHospitais) classes.push('OUTROS_HOSPITAIS');
  if (m.fazImobilizacoes) classes.push('IMOBILIZACOES');
  return classes;
}
