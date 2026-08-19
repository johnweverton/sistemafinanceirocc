// Recebíveis Repository — leitura da view vw_recebiveis (Contas a Receber, Story 4.4).
// Lê via service role (server-side). O status derivado (pago/cancelado/vencido/em_aberto) vem
// calculado da view (regra única no banco).
import type { Recebivel, FiltroRecebiveis } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import { toRecebivel, type RecebivelRow } from './mappers';

/**
 * Recebíveis de um conjunto de boletos (Story 8.3) — resumo do boleto vinculado/candidato
 * embutido nas transações do extrato (fila de sugestões mostra os dois lados sem N+1).
 */
export async function listarRecebiveisPorBoletoIds(boletoIds: string[]): Promise<Recebivel[]> {
  if (boletoIds.length === 0) return [];
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('vw_recebiveis').select('*').in('boleto_id', boletoIds);
  if (error) throw new ApiError(500, 'Falha ao buscar boletos vinculados', 'DB_ERROR', { error: error.message });
  return (data as RecebivelRow[]).map(toRecebivel);
}

/** Lista os recebíveis, aplicando filtros opcionais, ordenados por vencimento. */
export async function listarRecebiveis(filtros: FiltroRecebiveis = {}): Promise<Recebivel[]> {
  const db = getSupabaseAdmin();
  let query = db.from('vw_recebiveis').select('*').order('vencimento', { ascending: true, nullsFirst: false });

  if (filtros.competencia) query = query.eq('competencia', filtros.competencia);
  if (filtros.medicoId) query = query.eq('medico_id', filtros.medicoId);
  if (filtros.statusDerivado) query = query.eq('status_derivado', filtros.statusDerivado);
  if (filtros.contaEmissora) query = query.eq('conta_emissora', filtros.contaEmissora);
  if (filtros.tipoServico) query = query.eq('tipo_servico', filtros.tipoServico);

  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao listar recebíveis', 'DB_ERROR', { error: error.message });
  return (data as RecebivelRow[]).map(toRecebivel);
}
