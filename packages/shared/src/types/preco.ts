// Tabela de preços — parâmetros de configuração editáveis sem deploy (PRD §5.1, tabela `precos`).
import type { Classe } from './execucao';

/** Uma faixa de preço: até `teto` guias custa `valor`. */
export interface Faixa {
  teto: number;
  valor: number;
}

/**
 * Regra de excedente quando as guias passam do último teto.
 *  - 'por_guia': adiciona `valorExcedente` por guia acima do último teto.
 *  - 'fixo': aplica `valorFixo` (valor fixo único acima do último teto).
 *  - undefined: NÃO há regra — Engine deve sinalizar "FORA DA TABELA" (PRD §5.1, outros hospitais > 80).
 */
export interface RegraExcedente {
  tipo: 'por_guia' | 'fixo';
  valorExcedente?: number; // usado quando tipo = 'por_guia'
  valorFixo?: number; // usado quando tipo = 'fixo'
}

export interface TabelaPrecoClasse {
  faixas: Faixa[]; // ordenadas por teto crescente
  excedente?: RegraExcedente;
}

export type TabelaPreco = Record<Classe, TabelaPrecoClasse>;
