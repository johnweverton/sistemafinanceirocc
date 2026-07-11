// DRE Repository — lançamentos manuais de despesa fora da Cora (Story 9.1, Épico 9,
// D2/D4). Sem agregação de relatório nem expansão de recorrência ainda — isso é motor,
// entra na 9.2. Aqui é só CRUD puro com a validação cruzada avulso/recorrente ANTES de
// bater no banco (double-check do CHECK cruzado da migration 0023).
import type { ContaEmissora, LancamentoManual, TipoLancamentoManual } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import { toLancamentoManual, type LancamentoManualRow } from './mappers';

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
