// Domínio: Cliente Contábil — clientes do escritório de contabilidade que pagam honorários
// mensais (Story 11.1, Epic 11). Ver docs/architecture/feature-emissao-contabilidade.md (D1) para
// o desenho do @architect: propositalmente NÃO reaproveita a tabela `empresas` (Épico 10.4, que é
// especificamente sobre agregação de produção médica) — só os tipos de domínio de cobrança
// (DadosCobranca, CondicoesCobranca, ContaEmissora) e o mecanismo de regra de preço (RegraPreco).
import type { ContaEmissora } from './conta-emissora';
import type { DadosCobranca, CondicoesCobranca, RegraPreco } from './medico';

/** Regime tributário do cliente — metadado informativo/relatório. Quem decide a regra de cálculo
 *  é `modoCobranca`, não o regime (existem exceções fixas dentro do Simples Nacional). */
export type RegimeTributario = 'simples_nacional' | 'lucro_presumido';

/**
 * Modo de cobrança do cliente contábil (GATE do dono, 2026-07-22/24):
 *   - 'faixa_faturamento': valor do boleto varia por faturamento mensal informado (Story 11.2) —
 *     usa `regraPreco` forma 'faixa_faturamento'. Maioria (~80%) do Simples Nacional.
 *   - 'fixo': valor mensal fixo por contrato, reajustado 1x/ano (manual) — usa `regraPreco` forma
 *     'fixo'. Lucro Presumido + exceções do Simples Nacional (mesma regra de reajuste para ambos).
 */
export type ModoCobrancaContabilidade = 'faixa_faturamento' | 'fixo';

/**
 * Limites do CÁLCULO EM LOTE de clientes contábeis (Story 12.5, gap G-13). Moram aqui — e não no
 * schema/rota/orquestrador, cada um com o seu número — porque a partir da 12.5 a UI precisa
 * mostrá-los ANTES do clique, e um limite que a tela "acha que sabe" é pior que nenhum: o único
 * jeito de o painel de composição nunca mentir é ler do mesmo lugar que o servidor valida.
 * Consumidores: `execucao-schema.ts` (422), `execucao-orchestrator.ts` (LOTE_MUITO_GRANDE),
 * `api/clientes-contabilidade/lote/route.ts` (rate limit) e `LoteContabilidadeDialog.tsx` (aviso).
 */
export const LOTE_CONTABILIDADE_MAX_CLIENTES = 200;
/** Disparos de cálculo em lote por minuto, por usuário (rate limit da rota). */
export const LOTE_CONTABILIDADE_MAX_POR_MINUTO = 3;

export interface ClienteContabilidade {
  id: string;
  nome: string;
  regimeTributario: RegimeTributario;
  modoCobranca: ModoCobrancaContabilidade;
  /** Regra de preço (Story 10.1/10.4b, forma estendida em 11.1). Obrigatória para calcular o
   *  boleto mensal, mas pode ficar null durante o cadastro (mesmo padrão de `Empresa.regraPreco`). */
  regraPreco: RegraPreco | null;
  cobranca: DadosCobranca | null;
  contaEmissora: ContaEmissora;
  condicoes: CondicoesCobranca | null;
  /** Adicional semestral avulso (ex.: Vital Soluções, R$15.000 a cada 6 meses — Story 11.4). */
  adicionalAtivo: boolean;
  /** Valor do boleto avulso. Obrigatório quando `adicionalAtivo`. */
  adicionalValor: number | null;
  /** Intervalo em meses do ciclo (ex.: 6). Obrigatório quando `adicionalAtivo`. */
  adicionalIntervaloMeses: number | null;
  /** Primeira competência do ciclo, formato 'YYYY-MM'. Obrigatório quando `adicionalAtivo`. */
  adicionalCompetenciaBase: string | null;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClienteContabilidadeHistorico {
  id: string;
  clienteContabilidadeId: string;
  campoAlterado: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  alteradoPor: string;
  motivo: string | null;
  alteradoEm: string;
}

/**
 * Faturamento mensal informado para um cliente contábil no modo `faixa_faturamento` (Story
 * 11.2). Um lançamento por competência (`unique (cliente_contabilidade_id, competencia)`,
 * migration 0031) — relançar a mesma competência ATUALIZA o valor, não duplica.
 */
export interface ClienteContabilidadeFaturamento {
  id: string;
  clienteContabilidadeId: string;
  /** 'YYYY-MM'. */
  competencia: string;
  faturamento: number;
  informadoPor: string;
  informadoEm: string;
}
