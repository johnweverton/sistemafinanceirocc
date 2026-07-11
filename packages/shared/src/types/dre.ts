// DRE / Plano de Contas (Épico 9) — categorização contábil do extrato bancário (Épico 8) +
// lançamentos manuais de despesa fora da Cora. Fonte: docs/architecture/feature-dre-plano-contas.md
// Valores sempre em REAIS no domínio (mesmo padrão de extrato.ts).

import type { ContaEmissora } from './conta-emissora';

/**
 * Grupo do plano de contas — único enum FECHADO (dá a fórmula do DRE: receita −
 * deduções − despesas = resultado líquido). O nome da categoria dentro do grupo é livre
 * e editável via cadastro (D1).
 */
export type GrupoPlanoContas =
  | 'receita'
  | 'deducao_receita'
  | 'despesa_operacional'
  | 'despesa_financeira';

/** Todos os grupos válidos — fonte única para CHECKs de UI/Zod (espelha a CHECK do banco). */
export const GRUPOS_PLANO_CONTAS_VALIDOS = [
  'receita',
  'deducao_receita',
  'despesa_operacional',
  'despesa_financeira',
] as const satisfies readonly GrupoPlanoContas[];

/** Categoria do plano de contas — cadastro editável (D1), não enum fixo em código. */
export interface PlanoContas {
  id: string;
  grupo: GrupoPlanoContas;
  nome: string;
  /** true = seed protegido (Receita de honorários / Tarifas bancárias) — nunca deletável nem muda grupo/sistema (D3). */
  sistema: boolean;
  /** false = desativada (soft-disable); DELETE físico só sem vínculos em uso. */
  ativo: boolean;
  ordem: number;
  criadoEm: string;
}

/** Campo da transação/lançamento em que a regra procura o padrão (D3). */
export type CampoRegraCategorizacao = 'contraparte_nome' | 'descricao';

export const CAMPOS_REGRA_CATEGORIZACAO_VALIDOS = [
  'contraparte_nome',
  'descricao',
] as const satisfies readonly CampoRegraCategorizacao[];

/**
 * Regra de categorização automática por palavra-chave (D3) — substring
 * case-insensitive, sem regex (evita complexidade/ReDoS). Sempre resulta em
 * `status_categorizacao = sugerida` (exige confirmação humana), ao contrário das 2
 * auto-regras de sistema do motor (essas confirmam sozinhas).
 */
export interface RegraCategorizacao {
  id: string;
  categoriaId: string;
  campo: CampoRegraCategorizacao;
  /** Substring buscada (ILIKE), case-insensitive. */
  padrao: string;
  /** Menor primeiro; a primeira regra ativa que bate vence (determinístico). */
  prioridade: number;
  ativo: boolean;
  criadoEm: string;
}

/**
 * Estado da categorização de uma transação do extrato (D2 — eixo INDEPENDENTE de
 * StatusConciliacao):
 *   - sem_categoria: nenhuma regra bateu (estado inicial).
 *   - sugerida: regra do usuário bateu — exige confirmação humana.
 *   - confirmada: auto-regra de sistema (crédito conciliado / débito FEE) ou confirmação
 *     humana de uma sugestão.
 */
export type StatusCategorizacao = 'sem_categoria' | 'sugerida' | 'confirmada';

export const STATUS_CATEGORIZACAO_VALIDOS = [
  'sem_categoria',
  'sugerida',
  'confirmada',
] as const satisfies readonly StatusCategorizacao[];

/** Como o lançamento manual se repete no tempo (D4). */
export type TipoLancamentoManual = 'avulso' | 'recorrente';

export const TIPOS_LANCAMENTO_MANUAL_VALIDOS = [
  'avulso',
  'recorrente',
] as const satisfies readonly TipoLancamentoManual[];

/**
 * Lançamento manual de despesa fora da Cora (D2/D4) — categoria SEMPRE exigida (ao
 * contrário do extrato sincronizado, que chega sem nenhuma). Recorrente é um TEMPLATE
 * projetado na leitura do relatório (D4, sem cron): `dataInicio`/`dataFim` (null = sem
 * fim) + `diaDoMes` (1-28, evita mês curto) definem a janela; `data` só existe no avulso.
 */
export interface LancamentoManual {
  id: string;
  contaEmissora: ContaEmissora;
  categoriaId: string;
  descricao: string;
  valor: number;
  tipoLancamento: TipoLancamentoManual;
  /** Só no avulso. */
  data: string | null;
  /** Só no recorrente (1-28). */
  diaDoMes: number | null;
  /** Só no recorrente. */
  dataInicio: string | null;
  /** Só no recorrente; null = sem fim definido. */
  dataFim: string | null;
  criadoPor: string;
  criadoEm: string;
}
