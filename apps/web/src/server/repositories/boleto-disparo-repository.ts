import type { TipoDisparoBoleto } from '@cobranca/shared';
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
  tipo: TipoDisparoBoleto;
}

export interface RegistrarDisparoParams {
  boletoId: string;
  canal: DisparoCanal;
  status: DisparoStatus;
  mensagemErro?: string;
  /** Tipo do disparo (migration 0056) — default 'emissao', preserva as chamadas existentes
   *  (emitir-boleto.ts, reenviar_boleto/route.ts) sem precisar passar este campo. */
  tipo?: TipoDisparoBoleto;
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
      tipo: params.tipo ?? 'emissao',
    })
    .select('*')
    .single();

  if (error) {
    // Violação do índice único parcial uq_boletos_disparos_lembrete_sucesso (migration 0056) —
    // outra execução do cron já registrou este lembrete com sucesso entre a checagem de
    // idempotência (jaDisparado) e este insert. Não é uma falha real, é a trava fazendo o
    // trabalho dela: o chamador trata este código como "já foi enviado, tudo certo".
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw new ApiError(409, 'Disparo já registrado para este boleto (idempotência)', 'DISPARO_DUPLICADO');
    }
    throw new ApiError(500, 'Falha ao registrar disparo de boleto', 'DB_ERROR', { error: error.message });
  }

  return data as BoletoDisparoRow;
}

/**
 * Checa se já existe um disparo do `tipo` informado para este boleto — guarda de idempotência do
 * cron de lembrete de vencimento (Épico 13). Complementar ao índice único parcial
 * `uq_boletos_disparos_lembrete_sucesso` (migration 0056), que fecha a corrida de fato; esta
 * checagem evita a tentativa de reenvio na maioria dos casos (sem depender só do 23505).
 */
export async function jaDisparado(boletoId: string, tipo: TipoDisparoBoleto): Promise<boolean> {
  const db = getSupabaseAdmin();
  const { count, error } = await db
    .from('boletos_disparos')
    .select('id', { count: 'exact', head: true })
    .eq('boleto_id', boletoId)
    .eq('tipo', tipo);
  if (error) {
    throw new ApiError(500, 'Falha ao checar idempotência de disparo', 'DB_ERROR', { error: error.message });
  }
  return (count ?? 0) > 0;
}

/** Código de erro do Postgres para violação de unicidade (índice único parcial). */
export const PG_UNIQUE_VIOLATION = '23505';

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
 * Lista disparos de vários boletos de uma vez (badges do painel de Recebíveis),
 * retornando um mapa boletoId → disparos ordenados do mais antigo ao mais novo.
 */
export async function listarDisparosPorBoletos(
  boletoIds: string[],
): Promise<Record<string, BoletoDisparoRow[]>> {
  if (boletoIds.length === 0) return {};
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos_disparos')
    .select('*')
    .in('boleto_id', boletoIds)
    .order('enviado_em', { ascending: true });

  if (error) {
    throw new ApiError(500, 'Falha ao listar disparos dos boletos', 'DB_ERROR', { error: error.message });
  }

  const mapa: Record<string, BoletoDisparoRow[]> = {};
  for (const row of data as BoletoDisparoRow[]) {
    (mapa[row.boleto_id] ??= []).push(row);
  }
  return mapa;
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
