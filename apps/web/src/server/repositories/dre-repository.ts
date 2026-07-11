// DRE Repository — lançamentos manuais de despesa fora da Cora (Story 9.1) + agregação
// do relatório (Story 9.2, D4): fetch bruto de extrato_transacoes categorizadas +
// dre_lancamentos_manuais + plano_contas, delega a soma/expansão de recorrência ao
// engine puro `relatorio-dre.ts`.
import type { ContaEmissora, LancamentoManual, TipoLancamentoManual, GrupoPlanoContas } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import { toLancamentoManual, type LancamentoManualRow } from './mappers';
import { listarTransacoes } from './extrato-repository';
import { listarCategorias } from './plano-contas-repository';
import { gerarRelatorio, type RelatorioDre } from '@/server/engine/relatorio-dre';

interface CriarLancamentoBase {
  contaEmissora: ContaEmissora;
  categoriaId: string;
  descricao: string;
  valor: number;
  criadoPor: string;
}

export interface CriarLancamentoAvulsoInput extends CriarLancamentoBase {
  tipoLancamento: 'avulso';
  data: string;
}

export interface CriarLancamentoRecorrenteInput extends CriarLancamentoBase {
  tipoLancamento: 'recorrente';
  /** 1-28 — evita mês curto (fevereiro) na expansão futura do relatório (9.2, D4). */
  diaDoMes: number;
  dataInicio: string;
  /** null/ausente = sem fim definido (recorrência ativa indefinidamente). */
  dataFim?: string | null;
}

export type CriarLancamentoInput = CriarLancamentoAvulsoInput | CriarLancamentoRecorrenteInput;

/**
 * Espelha o CHECK cruzado da migration (`chk_dre_lanc_campos_por_tipo`) — validação
 * explícita no repository porque o caller (rota da 9.2) recebe JSON não tipado e o TS
 * discriminated union sozinho não protege contra dados vindos de fora da compilação.
 */
function validarCamposPorTipo(input: CriarLancamentoInput): void {
  if (input.tipoLancamento === 'avulso') {
    if (!input.data) {
      throw new ApiError(422, 'Lançamento avulso exige "data".', 'VALIDATION_ERROR');
    }
    return;
  }
  if (!Number.isInteger(input.diaDoMes) || input.diaDoMes < 1 || input.diaDoMes > 28) {
    throw new ApiError(422, 'Lançamento recorrente exige "diaDoMes" entre 1 e 28.', 'VALIDATION_ERROR');
  }
  if (!input.dataInicio) {
    throw new ApiError(422, 'Lançamento recorrente exige "dataInicio".', 'VALIDATION_ERROR');
  }
}

export async function criarLancamento(input: CriarLancamentoInput): Promise<LancamentoManual> {
  validarCamposPorTipo(input);

  const row =
    input.tipoLancamento === 'avulso'
      ? {
          conta_emissora: input.contaEmissora,
          categoria_id: input.categoriaId,
          descricao: input.descricao,
          valor: input.valor,
          tipo_lancamento: 'avulso' as const,
          data: input.data,
          dia_do_mes: null,
          data_inicio: null,
          data_fim: null,
          criado_por: input.criadoPor,
        }
      : {
          conta_emissora: input.contaEmissora,
          categoria_id: input.categoriaId,
          descricao: input.descricao,
          valor: input.valor,
          tipo_lancamento: 'recorrente' as const,
          data: null,
          dia_do_mes: input.diaDoMes,
          data_inicio: input.dataInicio,
          data_fim: input.dataFim ?? null,
          criado_por: input.criadoPor,
        };

  const db = getSupabaseAdmin();
  const { data, error } = await db.from('dre_lancamentos_manuais').insert(row).select('*').single();
  if (error) {
    throw new ApiError(500, 'Falha ao criar lançamento manual', 'DB_ERROR', { error: error.message });
  }
  return toLancamentoManual(data as LancamentoManualRow);
}

export interface FiltroLancamentos {
  contaEmissora?: ContaEmissora;
  tipoLancamento?: TipoLancamentoManual;
}

export async function listarLancamentos(
  filtro: FiltroLancamentos = {},
): Promise<LancamentoManual[]> {
  const db = getSupabaseAdmin();
  let query = db
    .from('dre_lancamentos_manuais')
    .select('*')
    .order('criado_em', { ascending: false });
  if (filtro.contaEmissora) query = query.eq('conta_emissora', filtro.contaEmissora);
  if (filtro.tipoLancamento) query = query.eq('tipo_lancamento', filtro.tipoLancamento);

  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, 'Falha ao listar lançamentos manuais', 'DB_ERROR', { error: error.message });
  }
  return (data as LancamentoManualRow[]).map(toLancamentoManual);
}

export async function excluirLancamento(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from('dre_lancamentos_manuais').delete().eq('id', id);
  if (error) {
    throw new ApiError(500, 'Falha ao excluir lançamento manual', 'DB_ERROR', { error: error.message });
  }
}

export interface CategoriaRelatorio {
  categoriaId: string;
  nome: string;
  grupo: GrupoPlanoContas;
  total: number;
}

export interface RelatorioDreResposta extends Omit<RelatorioDre, 'porCategoria'> {
  porCategoria: CategoriaRelatorio[];
}

/**
 * Monta o relatório DRE do período — busca dados brutos (transações categorizadas do
 * extrato + lançamentos manuais + plano de contas) e delega a soma/expansão de
 * recorrência ao engine puro (D4). `conta` ausente = consolidado MC+CV.
 */
export async function gerarRelatorioDre(
  periodo: { inicio: string; fim: string },
  conta?: ContaEmissora,
): Promise<RelatorioDreResposta> {
  const [transacoes, lancamentos, categorias] = await Promise.all([
    listarTransacoes({
      contaEmissora: conta,
      // Mesmo offset fixo -03:00 do GET /api/extrato (OBS-822, Épico 8) — as datas do
      // relatório representam o dia em Brasília, não em UTC.
      dataInicio: `${periodo.inicio}T00:00:00.000-03:00`,
      dataFim: `${periodo.fim}T23:59:59.999-03:00`,
    }),
    listarLancamentos(conta ? { contaEmissora: conta } : {}),
    listarCategorias(),
  ]);

  const resultado = gerarRelatorio(
    transacoes.map((t) => ({ contaEmissora: t.contaEmissora, categoriaId: t.categoriaId, valor: t.valor })),
    lancamentos.map((l) => ({
      contaEmissora: l.contaEmissora,
      categoriaId: l.categoriaId,
      valor: l.valor,
      tipoLancamento: l.tipoLancamento,
      data: l.data,
      diaDoMes: l.diaDoMes,
      dataInicio: l.dataInicio,
      dataFim: l.dataFim,
    })),
    categorias.map((c) => ({ id: c.id, grupo: c.grupo })),
    periodo,
    conta,
  );

  // FK (categoria_id → plano_contas.id) + guard de excluirCategoria (nunca deleta
  // categoria em uso) garantem que toda categoriaId do resultado existe no cadastro.
  const porId = new Map(categorias.map((c) => [c.id, c]));
  return {
    ...resultado,
    porCategoria: resultado.porCategoria.map((pc) => {
      const categoria = porId.get(pc.categoriaId)!;
      return { categoriaId: pc.categoriaId, nome: categoria.nome, grupo: categoria.grupo, total: pc.total };
    }),
  };
}
