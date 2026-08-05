// Dashboard Repository — leitura das views de agregação (Story 4.5). Via service role.
// As agregações reusam vw_recebiveis (0009) → status derivado único (não diverge).
import type { ResumoCompetencia, ResumoMedico, AgingFaixa, ContaEmissora } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toResumoCompetencia,
  toResumoMedico,
  toAgingFaixa,
  type ResumoCompetenciaRow,
  type ResumoMedicoRow,
  type AgingFaixaRow,
} from './mappers';

/**
 * Resumo por competência. Retorna as linhas por competência E a linha de rollup (competencia = null =
 * total geral), graças ao GROUPING SETS da view (0010). Filtro opcional para uma competência específica.
 * `contaEmissora` (migration 0042) é um filtro INDEPENDENTE — sempre aplicado (eq ou is-null), mesmo
 * quando `competencia` não é passada (ela continua sem filtro nesse caso, para alimentar o dropdown
 * numa query só).
 */
export async function resumoPorCompetencia(
  competencia?: string,
  contaEmissora?: ContaEmissora,
): Promise<ResumoCompetencia[]> {
  const db = getSupabaseAdmin();
  let query = db.from('vw_dashboard_competencia').select('*').order('competencia', { ascending: false });
  if (competencia) query = query.eq('competencia', competencia);
  query = contaEmissora ? query.eq('conta_emissora', contaEmissora) : query.is('conta_emissora', null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao carregar resumo por competência', 'DB_ERROR', { error: error.message });
  return (data as ResumoCompetenciaRow[]).map(toResumoCompetencia);
}

/**
 * Resumo por médico. Sem `competencia` → linha de rollup por médico (todas as competências, via
 * GROUPING SETS na view 0010). Com `competencia` → totais do médico naquela competência. Ordenado por
 * total emitido. Agregações (ticket/inadimplência) vêm do banco — não são recomputadas no cliente.
 * `contaEmissora` (migration 0042) segue o mesmo padrão: sem ela → rollup (IS NULL); com ela → eq.
 */
export async function resumoPorMedico(
  competencia?: string,
  contaEmissora?: ContaEmissora,
): Promise<ResumoMedico[]> {
  const db = getSupabaseAdmin();
  let query = db.from('vw_dashboard_medico').select('*').order('total_emitido', { ascending: false });
  query = competencia ? query.eq('competencia', competencia) : query.is('competencia', null);
  query = contaEmissora ? query.eq('conta_emissora', contaEmissora) : query.is('conta_emissora', null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao carregar resumo por médico', 'DB_ERROR', { error: error.message });
  return (data as ResumoMedicoRow[]).map(toResumoMedico);
}

/**
 * Aging de vencidos. Sem `competencia` → rollup por faixa (todas as competências). Com `competencia` →
 * aging daquela competência. (GROUPING SETS na view 0010.) `contaEmissora` (migration 0042) segue o
 * mesmo padrão independente: sem ela → rollup (IS NULL); com ela → eq.
 */
export async function aging(competencia?: string, contaEmissora?: ContaEmissora): Promise<AgingFaixa[]> {
  const db = getSupabaseAdmin();
  let query = db.from('vw_dashboard_aging').select('*');
  query = competencia ? query.eq('competencia', competencia) : query.is('competencia', null);
  query = contaEmissora ? query.eq('conta_emissora', contaEmissora) : query.is('conta_emissora', null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao carregar aging', 'DB_ERROR', { error: error.message });
  return (data as AgingFaixaRow[]).map(toAgingFaixa);
}
