// Execucao Repository — única porta de leitura/escrita de execucoes e execucao_resultados.
// Segue o mesmo padrão do medico-repository. Toda escrita é via service role (bypassa RLS):
// as policies só permitem leitura/insert de execução a clientes; progresso/resultados são
// gravados pelo servidor (architecture: Database Schema, seção RLS).
import type { Execucao, ExecucaoResultado, ResultadoMedico } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toExecucao,
  toExecucaoResultado,
  type ExecucaoRow,
  type ExecucaoResultadoRow,
} from './mappers';

export async function criarExecucao(
  competencia: string,
  iniciadoPor: string,
  totalMedicos: number,
): Promise<Execucao> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucoes')
    .insert({
      competencia,
      iniciado_por: iniciadoPor,
      status: 'processando',
      progresso: 0,
      total_medicos: totalMedicos,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao criar execução', 'DB_ERROR', { error: error.message });
  return toExecucao(data as ExecucaoRow);
}

export async function buscarExecucao(id: string): Promise<Execucao | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('execucoes').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar execução', 'DB_ERROR', { error: error.message });
  return data ? toExecucao(data as ExecucaoRow) : null;
}

export async function listarExecucoes(): Promise<Execucao[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucoes')
    .select('*')
    .order('iniciado_em', { ascending: false });
  if (error) throw new ApiError(500, 'Falha ao listar execuções', 'DB_ERROR', { error: error.message });
  return (data as ExecucaoRow[]).map(toExecucao);
}

export async function listarResultados(execucaoId: string): Promise<ExecucaoResultado[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucao_resultados')
    .select('*')
    .eq('execucao_id', execucaoId)
    .order('nome', { ascending: true });
  if (error) throw new ApiError(500, 'Falha ao buscar resultados', 'DB_ERROR', { error: error.message });
  return (data as ExecucaoResultadoRow[]).map(toExecucaoResultado);
}

/** Quantos resultados já foram gravados para esta execução (cursor de lote). */
export async function contarResultados(execucaoId: string): Promise<number> {
  const db = getSupabaseAdmin();
  const { count, error } = await db
    .from('execucao_resultados')
    .select('id', { count: 'exact', head: true })
    .eq('execucao_id', execucaoId);
  if (error) throw new ApiError(500, 'Falha ao contar resultados', 'DB_ERROR', { error: error.message });
  return count ?? 0;
}

/** Grava o resultado de um médico (resultado puro do Engine + ids). */
export async function gravarResultado(
  execucaoId: string,
  medicoId: string | null,
  r: ResultadoMedico,
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from('execucao_resultados').insert({
    execucao_id: execucaoId,
    medico_id: medicoId,
    cpf: r.cpf,
    nome: r.nome,
    procedimentos: r.procedimentos,
    cirurgias: r.cirurgias,
    guias: r.guias,
    guias_consolidado: r.guiasConsolidado,
    subtotais: r.subtotais,
    total_valor: r.totalValor,
    status: r.status,
    alertas: r.alertas,
  });
  if (error) throw new ApiError(500, 'Falha ao gravar resultado', 'DB_ERROR', { error: error.message });
}

export async function atualizarProgresso(execucaoId: string, progresso: number): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('execucoes')
    .update({ progresso: Math.min(100, Math.max(0, Math.round(progresso))) })
    .eq('id', execucaoId);
  if (error) throw new ApiError(500, 'Falha ao atualizar progresso', 'DB_ERROR', { error: error.message });
}

export interface TotaisExecucao {
  totalOk: number;
  totalAlerta: number;
  totalSemDados: number;
  totalGeralValor: number;
}

export async function concluirExecucao(execucaoId: string, totais: TotaisExecucao): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('execucoes')
    .update({
      status: 'concluido',
      progresso: 100,
      finalizado_em: new Date().toISOString(),
      total_ok: totais.totalOk,
      total_alerta: totais.totalAlerta,
      total_sem_dados: totais.totalSemDados,
      total_geral_valor: totais.totalGeralValor,
    })
    .eq('id', execucaoId);
  if (error) throw new ApiError(500, 'Falha ao concluir execução', 'DB_ERROR', { error: error.message });
}

export async function marcarErro(execucaoId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('execucoes')
    .update({ status: 'erro', finalizado_em: new Date().toISOString() })
    .eq('id', execucaoId);
  if (error) throw new ApiError(500, 'Falha ao marcar erro', 'DB_ERROR', { error: error.message });
}

/**
 * Guias do médico na execução CONCLUÍDA imediatamente anterior (competência < atual),
 * para alimentar a detecção de variação anômala (PRD §8.5). null se não houver.
 */
export async function guiasExecucaoAnterior(
  cpf: string,
  competenciaAtual: string,
): Promise<number | null> {
  const db = getSupabaseAdmin();
  // Junta resultados com execuções concluídas de competência anterior, pega a mais recente.
  const { data, error } = await db
    .from('execucao_resultados')
    .select('guias, execucoes!inner(competencia, status)')
    .eq('cpf', cpf)
    .eq('execucoes.status', 'concluido')
    .lt('execucoes.competencia', competenciaAtual)
    .order('execucoes(competencia)', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Não é fatal para a execução — variação só não será detectada.
    return null;
  }
  const guias = (data as { guias: number | null } | null)?.guias;
  return guias ?? null;
}
