// Execucao Repository — única porta de leitura/escrita de execucoes e execucao_resultados.
// Segue o mesmo padrão do medico-repository. Toda escrita é via service role (bypassa RLS):
// as policies só permitem leitura/insert de execução a clientes; progresso/resultados são
// gravados pelo servidor (architecture: Database Schema, seção RLS).
import type {
  Execucao,
  ExecucaoResultado,
  ExecucaoResumoMedico,
  ExecucaoHistoricoMedicoItem,
  ResultadoMedico,
} from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import { resolverEmailPorId, resolverEmailsPorIds } from '@/server/auth/resolver-email';
import {
  toExecucao,
  toExecucaoResultado,
  toExecucaoSelecao,
  toExecucaoResumoMedico,
  toExecucaoHistoricoMedicoItem,
  type ExecucaoRow,
  type ExecucaoResultadoRow,
  type ExecucaoSelecaoRow,
  type ExecucaoResumoMedicoRow,
  type ExecucaoHistoricoMedicoItemRow,
} from './mappers';

export async function criarExecucao(
  competencia: string,
  iniciadoPor: string,
  selecoes: {
    medicoId: string;
    producaoExternaId: string;
    producaoNome: string;
    producaoConsultasExternaId?: string | null;
    producaoConsultasNome?: string | null;
  }[],
): Promise<Execucao> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucoes')
    .insert({
      competencia,
      iniciado_por: iniciadoPor,
      status: 'processando',
      progresso: 0,
      total_medicos: selecoes.length,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao criar execução', 'DB_ERROR', { error: error.message });
  
  const execucaoId = data.id;
  const { error: selecoesError } = await db.from('execucao_selecoes').insert(
    selecoes.map((s) => ({
      execucao_id: execucaoId,
      medico_id: s.medicoId,
      producao_externa_id: s.producaoExternaId,
      producao_nome: s.producaoNome,
      producao_consultas_externa_id: s.producaoConsultasExternaId ?? null,
      producao_consultas_nome: s.producaoConsultasNome ?? null,
    }))
  );
  if (selecoesError) {
    // QA M-2: sem as seleções a execução nunca progride — marca erro para não deixar
    // registro zumbi em 'processando' (o insert de execucoes já foi commitado).
    await db
      .from('execucoes')
      .update({ status: 'erro', finalizado_em: new Date().toISOString() })
      .eq('id', execucaoId);
    throw new ApiError(500, 'Falha ao inserir seleções — execução marcada como erro', 'DB_ERROR', {
      error: selecoesError.message,
    });
  }

  return toExecucao(data as ExecucaoRow);
}

export async function buscarExecucao(id: string): Promise<Execucao | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('execucoes').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar execução', 'DB_ERROR', { error: error.message });
  if (!data) return null;
  const execucao = toExecucao(data as ExecucaoRow);
  // Pula a resolução enquanto "processando": esta função é re-chamada a cada 3s pelo polling de
  // fallback do frontend (useExecucaoRealtime), e o e-mail do autor não muda no meio do processamento.
  if (execucao.status === 'processando') return execucao;
  return { ...execucao, iniciadoPorEmail: await resolverEmailPorId(execucao.iniciadoPor) };
}

export async function listarSelecoes(execucaoId: string) {
  const db = getSupabaseAdmin();
  // QA H-1: ordenação por chave ÚNICA e estável. producao_nome empata em quase todas as
  // linhas ("Janeiro 2026" ×120) e ordem de empate não é determinística — o cursor de lote
  // (slice) refaz esta query a cada lote, então empate instável duplicaria/pularia médico.
  const { data, error } = await db
    .from('execucao_selecoes')
    .select('*')
    .eq('execucao_id', execucaoId)
    .order('medico_id', { ascending: true });
  if (error) throw new ApiError(500, 'Falha ao buscar seleções', 'DB_ERROR', { error: error.message });
  return (data as ExecucaoSelecaoRow[]).map(toExecucaoSelecao);
}

export async function listarExecucoes(): Promise<Execucao[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucoes')
    .select('*')
    .order('iniciado_em', { ascending: false });
  if (error) throw new ApiError(500, 'Falha ao listar execuções', 'DB_ERROR', { error: error.message });
  const execucoes = (data as ExecucaoRow[]).map(toExecucao);
  // Uma chamada para todos os autores da lista, não uma por linha (evita N+1 na Admin Auth API).
  const emails = await resolverEmailsPorIds([...new Set(execucoes.map((e) => e.iniciadoPor))]);
  return execucoes.map((e) => ({ ...e, iniciadoPorEmail: emails.get(e.iniciadoPor) ?? null }));
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

/**
 * Revisa e libera um resultado em 'alerta' para 'ok' — única forma de sair desse estado hoje
 * (não existe outro UPDATE em execucao_resultados). Preserva o status original e registra quem/
 * quando/por quê (migration 0014), para que a emissão de boleto (que só aceita status 'ok')
 * funcione sem nenhuma alteração na rota de emissão.
 */
export async function revisarResultado(
  resultadoId: string,
  revisorId: string,
  motivo: string,
): Promise<ExecucaoResultado> {
  const db = getSupabaseAdmin();
  const { data: atual, error: errBusca } = await db
    .from('execucao_resultados')
    .select('*')
    .eq('id', resultadoId)
    .maybeSingle();
  if (errBusca) throw new ApiError(500, 'Falha ao buscar resultado', 'DB_ERROR', { error: errBusca.message });
  if (!atual) throw new ApiError(404, 'Resultado de execução não encontrado', 'RESULTADO_NAO_ENCONTRADO');

  const atualRow = atual as ExecucaoResultadoRow;
  if (atualRow.status !== 'alerta') {
    throw new ApiError(
      400,
      `Só é possível revisar resultados com status 'alerta' (atual: '${atualRow.status}').`,
      'STATUS_INVALIDO',
    );
  }

  const { data, error } = await db
    .from('execucao_resultados')
    .update({
      status: 'ok',
      status_original: atualRow.status,
      revisado_por: revisorId,
      revisado_em: new Date().toISOString(),
      motivo_revisao: motivo,
    })
    .eq('id', resultadoId)
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao revisar resultado', 'DB_ERROR', { error: error.message });
  return toExecucaoResultado(data as ExecucaoResultadoRow);
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
  medicoId: string,
  competenciaAtual: string,
): Promise<number | null> {
  const db = getSupabaseAdmin();
  // Junta resultados com execuções concluídas de competência anterior, pega a mais recente.
  const { data, error } = await db
    .from('execucao_resultados')
    .select('guias, execucoes!inner(competencia, status)')
    .eq('medico_id', medicoId)
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

/**
 * Um médico por linha, com a ocorrência mais recente e a contagem total (visão "Por médico",
 * migration 0013 — lê a view vw_execucoes_resumo_medico).
 */
export async function listarResumoPorMedico(): Promise<ExecucaoResumoMedico[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('vw_execucoes_resumo_medico')
    .select('*')
    .order('nome', { ascending: true });
  if (error) throw new ApiError(500, 'Falha ao listar resumo por médico', 'DB_ERROR', { error: error.message });
  return (data as ExecucaoResumoMedicoRow[]).map(toExecucaoResumoMedico);
}

/**
 * Todas as ocorrências de um médico específico ao longo das competências (drill-down lazy da
 * visão "Por médico"). Diferente de guiasExecucaoAnterior, o erro aqui PROPAGA — a tela inteira
 * depende deste dado, não é um cálculo auxiliar que pode degradar silenciosamente.
 */
export async function historicoResultadosPorMedico(
  filtro: { medicoId: string } | { cpf: string },
): Promise<ExecucaoHistoricoMedicoItem[]> {
  const db = getSupabaseAdmin();
  let query = db
    .from('execucao_resultados')
    .select('execucao_id, status, total_valor, execucoes!inner(competencia, status, iniciado_em)')
    .order('execucoes(competencia)', { ascending: false });
  query = 'medicoId' in filtro ? query.eq('medico_id', filtro.medicoId) : query.eq('cpf', filtro.cpf).is('medico_id', null);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao buscar histórico do médico', 'DB_ERROR', { error: error.message });
  return (data as unknown as ExecucaoHistoricoMedicoItemRow[]).map(toExecucaoHistoricoMedicoItem);
}
