// Execucao Repository — única porta de leitura/escrita de execucoes e execucao_resultados.
// Segue o mesmo padrão do medico-repository. Toda escrita é via service role (bypassa RLS):
// as policies só permitem leitura/insert de execução a clientes; progresso/resultados são
// gravados pelo servidor (architecture: Database Schema, seção RLS).
import type {
  Execucao,
  ExecucaoResultado,
  ExecucaoResultadoContribuicao,
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
  toExecucaoResultadoContribuicao,
  toExecucaoSelecao,
  toExecucaoResumoMedico,
  toExecucaoHistoricoMedicoItem,
  type ExecucaoRow,
  type ExecucaoResultadoRow,
  type ExecucaoResultadoContribuicaoRow,
  type ExecucaoSelecaoRow,
  type ExecucaoResumoMedicoRow,
  type ExecucaoHistoricoMedicoItemRow,
} from './mappers';

export async function criarExecucao(
  competencia: string,
  iniciadoPor: string,
  selecoes: {
    medicoId: string;
    /** Null pra médico Angiologista (GATE 2026-08-07) — sem lote principal. */
    producaoExternaId: string | null;
    producaoNome: string | null;
    producaoConsultasExternaId?: string | null;
    producaoConsultasNome?: string | null;
    producaoOutrosHospitaisExternaId?: string | null;
    producaoOutrosHospitaisNome?: string | null;
    producaoImobilizacoesExternaId?: string | null;
    producaoImobilizacoesNome?: string | null;
    producaoCateterExternaId?: string | null;
    producaoCateterNome?: string | null;
    producaoFistulaExternaId?: string | null;
    producaoFistulaNome?: string | null;
    producaoAngiografiaExternaId?: string | null;
    producaoAngiografiaNome?: string | null;
    /** Carta de Rede (médico Angiologista, GATE 2026-08-12) — contagem MANUAL, sem itens da API. */
    producaoCartaRedeExternaId?: string | null;
    producaoCartaRedeNome?: string | null;
    cartaRedeGuias?: number | null;
  }[],
  /** Marca a execução como agregada por empresa (Story 10.4b) — null/ausente = execução normal. */
  empresaId?: string | null,
  /** Marca a execução como sendo de cliente contábil (Story 11.3) — null/ausente = execução normal. */
  clienteContabilidadeId?: string | null,
  /** Marca a execução como o boleto avulso do adicional semestral (Story 11.4). */
  ehAdicional?: boolean,
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
      empresa_id: empresaId ?? null,
      cliente_contabilidade_id: clienteContabilidadeId ?? null,
      eh_adicional: ehAdicional ?? false,
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
      producao_outros_hospitais_externa_id: s.producaoOutrosHospitaisExternaId ?? null,
      producao_outros_hospitais_nome: s.producaoOutrosHospitaisNome ?? null,
      producao_imobilizacoes_externa_id: s.producaoImobilizacoesExternaId ?? null,
      producao_imobilizacoes_nome: s.producaoImobilizacoesNome ?? null,
      producao_cateter_externa_id: s.producaoCateterExternaId ?? null,
      producao_cateter_nome: s.producaoCateterNome ?? null,
      producao_fistula_externa_id: s.producaoFistulaExternaId ?? null,
      producao_fistula_nome: s.producaoFistulaNome ?? null,
      producao_angiografia_externa_id: s.producaoAngiografiaExternaId ?? null,
      producao_angiografia_nome: s.producaoAngiografiaNome ?? null,
      producao_carta_rede_externa_id: s.producaoCartaRedeExternaId ?? null,
      producao_carta_rede_nome: s.producaoCartaRedeNome ?? null,
      carta_rede_guias: s.cartaRedeGuias ?? null,
      // Auditoria de quem digitou (mesmo padrão de clientes_contabilidade_faturamentos) — só
      // grava quando o operador de fato informou um número nesta seleção.
      carta_rede_informado_por: s.cartaRedeGuias != null ? iniciadoPor : null,
      carta_rede_informado_em: s.cartaRedeGuias != null ? new Date().toISOString() : null,
    }))
  );
  if (selecoesError) {
    // QA M-2: sem as seleções a execução nunca progride — marca erro para não deixar
    // registro zumbi em 'processando' (o insert de execucoes já foi commitado).
    await db
      .from('execucoes')
      .update({ status: 'erro', finalizado_em: new Date().toISOString() })
      .eq('id', execucaoId);
    throw new ApiError(500, 'Falha ao inserir seleções. Execução marcada como erro', 'DB_ERROR', {
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
  const execucoesComEmail = execucoes.map((e) => ({ ...e, iniciadoPorEmail: emails.get(e.iniciadoPor) ?? null }));

  // Execuções "pontuais" (totalMedicos === 1, disparadas pelo modo "Por médico" da tela Nova
  // Emissão) têm exatamente 1 resultado — busca em LOTE (não N+1) o nome do médico pra alimentar
  // a busca por nome no histórico de emissões.
  const idsPontuais = execucoesComEmail.filter((e) => e.totalMedicos === 1).map((e) => e.id);
  if (idsPontuais.length === 0) return execucoesComEmail;

  const { data: resultados, error: errResultados } = await db
    .from('execucao_resultados')
    .select('execucao_id, nome')
    .in('execucao_id', idsPontuais);
  if (errResultados) {
    throw new ApiError(500, 'Falha ao buscar nome do médico das execuções pontuais', 'DB_ERROR', {
      error: errResultados.message,
    });
  }
  const nomesPorExecucao = new Map(
    (resultados as { execucao_id: string; nome: string }[]).map((r) => [r.execucao_id, r.nome]),
  );
  return execucoesComEmail.map((e) =>
    idsPontuais.includes(e.id) ? { ...e, medicoNome: nomesPorExecucao.get(e.id) ?? null } : e,
  );
}

/**
 * Resultados 'ok' de uma execução — candidatos ao preview de emissão em lote (migration 0038).
 * Linhas CRUAS (snake_case), mesmo formato que `validarResultadoParaEmissao` espera — evita um
 * adaptador camelCase↔snake_case só para isso.
 */
export async function listarResultadosOkParaEmissao(execucaoId: string): Promise<ExecucaoResultadoRow[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucao_resultados')
    .select('*')
    .eq('execucao_id', execucaoId)
    .eq('status', 'ok')
    .order('nome', { ascending: true });
  if (error) {
    throw new ApiError(500, 'Falha ao listar resultados para emissão em lote', 'DB_ERROR', { error: error.message });
  }
  return data as ExecucaoResultadoRow[];
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

/** Um resultado específico por id — usado pelo recálculo (migration 0041) para checar o médico/
 * execução de origem antes de reprocessar. */
export async function buscarResultadoPorId(resultadoId: string): Promise<ExecucaoResultado | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucao_resultados')
    .select('*')
    .eq('id', resultadoId)
    .maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar resultado', 'DB_ERROR', { error: error.message });
  return data ? toExecucaoResultado(data as ExecucaoResultadoRow) : null;
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
 * Grava o resultado AGREGADO de uma empresa (Story 10.4b) — `medico_id` fica null, `empresa_id`
 * setado (CHECK `chk_execucao_resultados_nao_ambos_medico_empresa`, migration 0029). Devolve o
 * id do resultado criado para gravar as contribuições por médico em seguida.
 */
export async function gravarResultadoEmpresa(
  execucaoId: string,
  empresaId: string,
  r: { nome: string; guias: number; totalValor: number; status: ExecucaoResultado['status']; alertas: string[]; subtotalFaixa: string },
): Promise<string> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucao_resultados')
    .insert({
      execucao_id: execucaoId,
      empresa_id: empresaId,
      medico_id: null,
      cpf: '',
      nome: r.nome,
      procedimentos: null,
      cirurgias: null,
      guias: r.guias,
      guias_consolidado: null,
      subtotais:
        r.status === 'ok'
          ? [{ classe: 'PRECO_PROPRIO', guias: r.guias, valor: r.totalValor, faixa: r.subtotalFaixa }]
          : [],
      total_valor: r.totalValor,
      status: r.status,
      alertas: r.alertas,
    })
    .select('id')
    .single();
  if (error) throw new ApiError(500, 'Falha ao gravar resultado da empresa', 'DB_ERROR', { error: error.message });
  return (data as { id: string }).id;
}

/**
 * Grava o resultado de um cliente contábil (Story 11.3) — `medico_id`/`empresa_id` ficam null,
 * `cliente_contabilidade_id` setado (CHECK `chk_execucao_resultados_exclusao_mutua`, migration
 * 0032). Sem agregação (diferente de `gravarResultadoEmpresa`) — um valor único calculado por
 * `aplicarRegraPreco` (Story 11.2), por isso não há `guias` nem contribuições por médico.
 */
export async function gravarResultadoClienteContabilidade(
  execucaoId: string,
  clienteContabilidadeId: string,
  r: { nome: string; totalValor: number; status: ExecucaoResultado['status']; alertas: string[]; subtotalFaixa: string },
): Promise<string> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucao_resultados')
    .insert({
      execucao_id: execucaoId,
      cliente_contabilidade_id: clienteContabilidadeId,
      medico_id: null,
      cpf: '',
      nome: r.nome,
      procedimentos: null,
      cirurgias: null,
      guias: null,
      guias_consolidado: null,
      subtotais:
        r.status === 'ok'
          ? [{ classe: 'PRECO_PROPRIO', guias: 0, valor: r.totalValor, faixa: r.subtotalFaixa }]
          : [],
      total_valor: r.totalValor,
      status: r.status,
      alertas: r.alertas,
    })
    .select('id')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao gravar resultado do cliente contábil', 'DB_ERROR', {
      error: error.message,
    });
  }
  return (data as { id: string }).id;
}

/** Grava a auditoria "qual médico contribuiu quanto" de um resultado agregado (Story 10.4b). */
export async function gravarContribuicoes(
  execucaoResultadoId: string,
  contribuicoes: { medicoId: string; guias: number; valor: number }[],
): Promise<void> {
  if (contribuicoes.length === 0) return;
  const db = getSupabaseAdmin();
  const { error } = await db.from('execucao_resultado_contribuicoes').insert(
    contribuicoes.map((c) => ({
      execucao_resultado_id: execucaoResultadoId,
      medico_id: c.medicoId,
      guias: c.guias,
      valor: c.valor,
    })),
  );
  if (error) {
    throw new ApiError(500, 'Resultado da empresa gravado mas contribuições falharam. Verificar', 'CONTRIBUICOES_ERROR', {
      error: error.message,
    });
  }
}

/** Contribuições por médico de um resultado agregado (Story 10.4b) — auditoria/detalhe na UI. */
export async function listarContribuicoes(execucaoResultadoId: string): Promise<ExecucaoResultadoContribuicao[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucao_resultado_contribuicoes')
    .select('*')
    .eq('execucao_resultado_id', execucaoResultadoId)
    .order('guias', { ascending: false });
  if (error) throw new ApiError(500, 'Falha ao buscar contribuições', 'DB_ERROR', { error: error.message });
  return (data as ExecucaoResultadoContribuicaoRow[]).map(toExecucaoResultadoContribuicao);
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

/**
 * Sobrescreve um resultado já gravado com um novo cálculo do Engine (migration 0041, achado
 * real 2026-08-04, Dr. José Neias) — reprocessa a MESMA linha em vez de criar uma execução nova,
 * para quando o dado de origem foi corrigido DEPOIS que a execução já rodou. Limpa
 * status_original/revisado_* (refletiam o cálculo ANTIGO, agora obsoleto) e grava
 * recalculado_por/recalculado_em como o novo rastro de auditoria. Quem chama (orchestrator) já
 * garantiu que não existe boleto ativo para este resultado antes de chegar aqui.
 */
export async function atualizarResultado(
  resultadoId: string,
  r: ResultadoMedico,
  recalculadoPor: string,
): Promise<ExecucaoResultado> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucao_resultados')
    .update({
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
      status_original: null,
      revisado_por: null,
      revisado_em: null,
      motivo_revisao: null,
      recalculado_por: recalculadoPor,
      recalculado_em: new Date().toISOString(),
    })
    .eq('id', resultadoId)
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao atualizar resultado recalculado', 'DB_ERROR', { error: error.message });
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

/**
 * Todas as ocorrências de um cliente contábil ao longo das competências (Story 11.5) — mesmo
 * padrão de `historicoResultadosPorMedico`, reaproveitando o mesmo tipo/mapper (nenhum campo é
 * específico de médico). Inclui `eh_adicional` (Story 11.4) para diferenciar boleto mensal do
 * adicional semestral na listagem.
 */
export async function historicoResultadosPorClienteContabilidade(
  clienteContabilidadeId: string,
): Promise<ExecucaoHistoricoMedicoItem[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('execucao_resultados')
    .select('execucao_id, status, total_valor, execucoes!inner(competencia, status, iniciado_em, eh_adicional)')
    .eq('cliente_contabilidade_id', clienteContabilidadeId)
    .order('execucoes(competencia)', { ascending: false });
  if (error) {
    throw new ApiError(500, 'Falha ao buscar histórico do cliente contábil', 'DB_ERROR', { error: error.message });
  }
  return (data as unknown as ExecucaoHistoricoMedicoItemRow[]).map(toExecucaoHistoricoMedicoItem);
}
