// Cliente Contábil Faturamento Repository — lançamento mensal de faturamento (Story 11.2,
// Epic 11), usado pelo modo `faixa_faturamento`. Um lançamento por competência (`unique
// (cliente_contabilidade_id, competencia)`, migration 0031) — relançar a mesma competência
// ATUALIZA o valor (upsert), não duplica. Diferente de médico/empresa/cadastro de cliente
// contábil, este lançamento NÃO gera histórico de auditoria por campo — é o próprio registro
// versionado por competência que serve de trilha (quem lançou e quando, em `informado_por`/
// `informado_em`).
import type { ClienteContabilidadeFaturamento } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toClienteContabilidadeFaturamento,
  type ClienteContabilidadeFaturamentoRow,
} from './mappers';

/**
 * Lança (ou atualiza, se a competência já tiver um lançamento) o faturamento de um cliente
 * contábil. Upsert por `(cliente_contabilidade_id, competencia)` — espelha a constraint UNIQUE
 * da migration 0031.
 */
export async function lancarFaturamento(
  clienteContabilidadeId: string,
  competencia: string,
  faturamento: number,
  informadoPor: string,
): Promise<ClienteContabilidadeFaturamento> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('clientes_contabilidade_faturamentos')
    .upsert(
      {
        cliente_contabilidade_id: clienteContabilidadeId,
        competencia,
        faturamento,
        informado_por: informadoPor,
        informado_em: new Date().toISOString(),
      },
      { onConflict: 'cliente_contabilidade_id,competencia' },
    )
    .select('*')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao lançar faturamento', 'DB_ERROR', { error: error.message });
  }
  return toClienteContabilidadeFaturamento(data as ClienteContabilidadeFaturamentoRow);
}

export interface LancamentoFaturamentoLote {
  clienteContabilidadeId: string;
  faturamento: number;
}

export interface ResultadoLancamentoFaturamentoLote {
  lancados: number;
  falhas: { clienteContabilidadeId: string; motivo: string }[];
}

/**
 * Lança faturamento de VÁRIOS clientes na mesma competência (feedback do dono, 2026-08-20) —
 * passo que precede o cálculo em lote pros clientes `faixa_faturamento` (o valor do boleto
 * desse modo depende do faturamento já lançado). Falha individual não aborta o lote — mesmo
 * espírito de `excluirClientesContabilidade`.
 */
export async function lancarFaturamentoLote(
  competencia: string,
  lancamentos: LancamentoFaturamentoLote[],
  informadoPor: string,
): Promise<ResultadoLancamentoFaturamentoLote> {
  const resultado: ResultadoLancamentoFaturamentoLote = { lancados: 0, falhas: [] };
  for (const l of lancamentos) {
    try {
      await lancarFaturamento(l.clienteContabilidadeId, competencia, l.faturamento, informadoPor);
      resultado.lancados += 1;
    } catch (e) {
      const motivo = e instanceof ApiError ? e.message : 'Falha ao lançar faturamento';
      resultado.falhas.push({ clienteContabilidadeId: l.clienteContabilidadeId, motivo });
    }
  }
  return resultado;
}

export async function listarFaturamentos(
  clienteContabilidadeId: string,
): Promise<ClienteContabilidadeFaturamento[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('clientes_contabilidade_faturamentos')
    .select('*')
    .eq('cliente_contabilidade_id', clienteContabilidadeId)
    .order('competencia', { ascending: false });
  if (error) {
    throw new ApiError(500, 'Falha ao listar faturamentos', 'DB_ERROR', { error: error.message });
  }
  return (data as ClienteContabilidadeFaturamentoRow[]).map(toClienteContabilidadeFaturamento);
}

export async function buscarFaturamento(
  clienteContabilidadeId: string,
  competencia: string,
): Promise<ClienteContabilidadeFaturamento | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('clientes_contabilidade_faturamentos')
    .select('*')
    .eq('cliente_contabilidade_id', clienteContabilidadeId)
    .eq('competencia', competencia)
    .maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao buscar faturamento', 'DB_ERROR', { error: error.message });
  }
  return data ? toClienteContabilidadeFaturamento(data as ClienteContabilidadeFaturamentoRow) : null;
}
