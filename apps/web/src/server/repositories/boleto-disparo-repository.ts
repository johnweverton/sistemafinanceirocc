import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';

export type DisparoCanal = 'whatsapp' | 'email';
export type DisparoStatus = 'sucesso' | 'falha';

export interface BoletoDisparoRow {
  id: string;
  boleto_id: string;
  canal: DisparoCanal;
  status: DisparoStatus;
  mensagem_erro: string | null;
  enviado_em: string;
}

export interface RegistrarDisparoParams {
  boletoId: string;
  canal: DisparoCanal;
  status: DisparoStatus;
  mensagemErro?: string;
}

/**
 * Registra uma tentativa de disparo de boleto no banco de dados.
 */
export async function registrarDisparo(params: RegistrarDisparoParams): Promise<BoletoDisparoRow> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos_disparos')
    .insert({
      boleto_id: params.boletoId,
      canal: params.canal,
      status: params.status,
      mensagem_erro: params.mensagemErro ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw new ApiError(500, 'Falha ao registrar disparo de boleto', 'DB_ERROR', { error: error.message });
  }

  return data as BoletoDisparoRow;
}

/**
 * Lista todos os disparos de um boleto.
 */
export async function listarDisparosPorBoleto(boletoId: string): Promise<BoletoDisparoRow[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos_disparos')
    .select('*')
    .eq('boleto_id', boletoId)
    .order('enviado_em', { ascending: true });

  if (error) {
    throw new ApiError(500, 'Falha ao listar disparos', 'DB_ERROR', { error: error.message });
  }

  return data as BoletoDisparoRow[];
}

/**
 * Lista disparos de toda a execução, retornando um mapa onde a chave é o execucaoResultadoId
 */
export async function listarDisparosPorExecucao(execucaoId: string): Promise<Record<string, BoletoDisparoRow[]>> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos_disparos')
    .select('*, boletos!inner(execucao_resultado_id, execucao_resultados!inner(execucao_id))')
    .eq('boletos.execucao_resultados.execucao_id', execucaoId);

  if (error) {
    throw new ApiError(500, 'Falha ao listar disparos da execução', 'DB_ERROR', { error: error.message });
  }

  const mapa: Record<string, BoletoDisparoRow[]> = {};
  for (const row of data as any[]) {
    const resId = row.boletos.execucao_resultado_id;
    if (!mapa[resId]) mapa[resId] = [];
    mapa[resId].push(row as BoletoDisparoRow);
  }
  return mapa;
}
