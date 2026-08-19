// Dashboard Repository — leitura das views de agregação (Story 4.5). Via service role.
// As agregações reusam vw_recebiveis (0009) → status derivado único (não diverge).
import type {
  ResumoCompetencia,
  ResumoMedico,
  ResumoPorEmpresa,
  ResumoPorTipoServico,
  AgingFaixa,
  ContaEmissora,
  TipoServico,
} from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toResumoCompetencia,
  toResumoMedico,
  toResumoPorEmpresa,
  toResumoPorTipoServico,
  toAgingFaixa,
  type ResumoCompetenciaRow,
  type ResumoMedicoRow,
  type ResumoPorEmpresaRow,
  type ResumoPorTipoServicoRow,
  type AgingFaixaRow,
} from './mappers';

/**
 * Resumo por competência. Retorna as linhas por competência E a linha de rollup (competencia = null =
 * total geral), graças ao GROUPING SETS da view (0010). Filtro opcional para uma competência específica.
 * `contaEmissora` (migration 0042) e `tipoServico` (migration 0050) são filtros INDEPENDENTES — sempre
 * aplicados (eq ou is-null), mesmo quando `competencia` não é passada (ela continua sem filtro nesse
 * caso, para alimentar o dropdown numa query só).
 */
export async function resumoPorCompetencia(
  competencia?: string,
  contaEmissora?: ContaEmissora,
  tipoServico?: TipoServico,
): Promise<ResumoCompetencia[]> {
  const db = getSupabaseAdmin();
  let query = db.from('vw_dashboard_competencia').select('*').order('competencia', { ascending: false });
  if (competencia) query = query.eq('competencia', competencia);
  query = contaEmissora ? query.eq('conta_emissora', contaEmissora) : query.is('conta_emissora', null);
  query = tipoServico ? query.eq('tipo_servico', tipoServico) : query.is('tipo_servico', null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao carregar resumo por competência', 'DB_ERROR', { error: error.message });
  return (data as ResumoCompetenciaRow[]).map(toResumoCompetencia);
}

/**
 * Resumo por médico. Sem `competencia` → linha de rollup por médico (todas as competências, via
 * GROUPING SETS na view 0010). Com `competencia` → totais do médico naquela competência. Ordenado por
 * total emitido. Agregações (ticket/inadimplência) vêm do banco — não são recomputadas no cliente.
 * `contaEmissora` (migration 0042) e `tipoServico` (migration 0050) seguem o mesmo padrão: sem eles →
 * rollup (IS NULL); com eles → eq. Cliente contábil aparece aqui com medico_id NULL e nome = nome do
 * cliente (mesmo desenho de sempre) — filtrar tipoServico='contabilidade' isola essas linhas, é o
 * "relatório dos clientes de contabilidade" pedido pelo dono, sem view nova.
 */
export async function resumoPorMedico(
  competencia?: string,
  contaEmissora?: ContaEmissora,
  tipoServico?: TipoServico,
): Promise<ResumoMedico[]> {
  const db = getSupabaseAdmin();
  let query = db.from('vw_dashboard_medico').select('*').order('total_emitido', { ascending: false });
  query = competencia ? query.eq('competencia', competencia) : query.is('competencia', null);
  query = contaEmissora ? query.eq('conta_emissora', contaEmissora) : query.is('conta_emissora', null);
  query = tipoServico ? query.eq('tipo_servico', tipoServico) : query.is('tipo_servico', null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao carregar resumo por médico', 'DB_ERROR', { error: error.message });
  return (data as ResumoMedicoRow[]).map(toResumoMedico);
}

/**
 * Resumo por empresa (conta emissora) — Módulo de Relatórios. Consulta o mesmo grouping set
 * (competencia, conta_emissora) de `vw_dashboard_competencia` (0010/0042), mas isolado por
 * conta_emissora (nunca NULL) — o eixo inverso de `resumoPorCompetencia`, que sempre isola
 * por competência. Sem `competencia` → rollup por empresa (todas as competências). `tipo_servico`
 * fica sempre em rollup aqui (IS NULL) — este resumo não quebra por tipo de serviço, ver
 * `resumoPorTipoServico` pra isso.
 */
export async function resumoPorEmpresa(
  competencia?: string,
  contaEmissora?: ContaEmissora,
): Promise<ResumoPorEmpresa[]> {
  const db = getSupabaseAdmin();
  let query = db
    .from('vw_dashboard_competencia')
    .select('*')
    .not('conta_emissora', 'is', null)
    .is('tipo_servico', null);
  query = competencia ? query.eq('competencia', competencia) : query.is('competencia', null);
  if (contaEmissora) query = query.eq('conta_emissora', contaEmissora);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao carregar resumo por empresa', 'DB_ERROR', { error: error.message });
  return (data as ResumoPorEmpresaRow[]).map(toResumoPorEmpresa);
}

/**
 * Resumo por tipo de serviço (Cobrança Médica vs Contabilidade, migration 0050) — feedback do
 * dono 2026-08-19: "separar as emissões realizadas para o serviço de contabilidade e emissões
 * para o serviço de cobranças médicas". Mesmo eixo de `resumoPorEmpresa`, mas isolado por
 * tipo_servico (nunca NULL) em vez de conta_emissora. `contaEmissora` opcional (sem ela → rollup,
 * IS NULL) — usado pelo BI público (api/relatorios/publico/[token]) pra respeitar o escopo do
 * link: um link restrito a uma conta não pode vazar o total de outra através deste resumo.
 */
export async function resumoPorTipoServico(
  competencia?: string,
  contaEmissora?: ContaEmissora,
): Promise<ResumoPorTipoServico[]> {
  const db = getSupabaseAdmin();
  let query = db.from('vw_dashboard_competencia').select('*').not('tipo_servico', 'is', null);
  query = competencia ? query.eq('competencia', competencia) : query.is('competencia', null);
  query = contaEmissora ? query.eq('conta_emissora', contaEmissora) : query.is('conta_emissora', null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao carregar resumo por tipo de serviço', 'DB_ERROR', { error: error.message });
  return (data as ResumoPorTipoServicoRow[]).map(toResumoPorTipoServico);
}

/**
 * Aging de vencidos. Sem `competencia` → rollup por faixa (todas as competências). Com `competencia` →
 * aging daquela competência. (GROUPING SETS na view 0010.) `contaEmissora` (migration 0042) e
 * `tipoServico` (migration 0050) seguem o mesmo padrão independente: sem eles → rollup (IS NULL);
 * com eles → eq.
 */
export async function aging(
  competencia?: string,
  contaEmissora?: ContaEmissora,
  tipoServico?: TipoServico,
): Promise<AgingFaixa[]> {
  const db = getSupabaseAdmin();
  let query = db.from('vw_dashboard_aging').select('*');
  query = competencia ? query.eq('competencia', competencia) : query.is('competencia', null);
  query = contaEmissora ? query.eq('conta_emissora', contaEmissora) : query.is('conta_emissora', null);
  query = tipoServico ? query.eq('tipo_servico', tipoServico) : query.is('tipo_servico', null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao carregar aging', 'DB_ERROR', { error: error.message });
  return (data as AgingFaixaRow[]).map(toAgingFaixa);
}
