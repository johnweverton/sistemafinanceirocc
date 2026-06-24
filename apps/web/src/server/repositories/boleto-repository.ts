// Boleto Repository — única porta de leitura/escrita da tabela boletos.
// Segue o mesmo padrão do medico-repository e execucao-repository.
// Toda escrita via service role (bypassa RLS).
import type { Boleto, GatewayBoleto, StatusBoleto } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import { toBoleto, type BoletoRow } from './mappers';

export interface CriarBoletoParams {
  execucaoResultadoId: string;
  gateway: GatewayBoleto;
  idExterno: string | null;
  status: StatusBoleto;
  emitidoPor: string;
  payloadResposta: unknown;
}

/** Persiste um boleto na tabela de auditoria. */
export async function criarBoleto(params: CriarBoletoParams): Promise<Boleto> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .insert({
      execucao_resultado_id: params.execucaoResultadoId,
      gateway: params.gateway,
      id_externo: params.idExterno,
      status: params.status,
      emitido_por: params.emitidoPor,
      payload_resposta: params.payloadResposta,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao registrar boleto', 'DB_ERROR', { error: error.message });
  return toBoleto(data as BoletoRow);
}

/** Verifica se já existe boleto emitido com sucesso para um resultado (idempotência). */
export async function buscarBoletoEmitido(execucaoResultadoId: string): Promise<Boleto | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('*')
    .eq('execucao_resultado_id', execucaoResultadoId)
    .eq('status', 'emitido')
    .maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar boleto', 'DB_ERROR', { error: error.message });
  return data ? toBoleto(data as BoletoRow) : null;
}

/** Lista todos os boletos de um resultado (incluindo falhas, para auditoria). */
export async function listarBoletosPorResultado(execucaoResultadoId: string): Promise<Boleto[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('*')
    .eq('execucao_resultado_id', execucaoResultadoId)
    .order('emitido_em', { ascending: false });
  if (error) throw new ApiError(500, 'Falha ao listar boletos', 'DB_ERROR', { error: error.message });
  return (data as BoletoRow[]).map(toBoleto);
}

/** Lista boletos de todos os resultados de uma execução (join via execucao_resultados). */
export async function listarBoletosPorExecucao(execucaoId: string): Promise<Boleto[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('*, execucao_resultados!inner(execucao_id)')
    .eq('execucao_resultados.execucao_id', execucaoId)
    .order('emitido_em', { ascending: false });
  if (error) throw new ApiError(500, 'Falha ao listar boletos da execução', 'DB_ERROR', { error: error.message });
  // O select retorna campos extras do join; extraímos só as colunas do boleto.
  return (data as BoletoRow[]).map(toBoleto);
}
