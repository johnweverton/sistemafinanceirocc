// ISS Captura Repository — ÚNICA porta de escrita/leitura de iss_execucoes_agente e iss_capturas
// (Story 13.1, Épico 13 — docs/architecture/feature-agente-faturamento-iss.md). O que entra aqui é
// PROPOSTA (decisão G3): nada neste arquivo escreve em clientes_contabilidade_faturamentos — o
// lançamento oficial continua sendo do operador, pelo `lancarFaturamentoLote`.
import type {
  AlvosIssResposta,
  CapturaIss,
  ExecucaoIssRegistrada,
  TotaisExecucaoIss,
  UltimaExecucaoIss,
} from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  alertasDaCapturaIss,
  competenciasAnteriores,
  COMPETENCIA_INICIO_EMISSOR_NACIONAL,
  JANELA_HISTORICO_R5,
} from '@/server/engine/alertas-captura-iss';
import type { NovaExecucaoIssInput } from '@/server/validation/agente-iss-schema';
import { toCapturaIss, type IssCapturaRow } from './mappers';
import {
  listarClientesContabilidade,
  listarClientesContabilidadePorIds,
} from './cliente-contabilidade-repository';

function somenteDigitos(doc: string | null | undefined): string {
  return (doc ?? '').replace(/\D/g, '');
}

/**
 * Quem o agente deve buscar no portal: clientes ATIVOS em `faixa_faturamento` (os `fixo` não
 * dependem de faturamento). Documento com 11/14 dígitos vai para `alvos`; sem documento válido
 * vai para `semDocumento` — o agente não tem como achar no portal, e a UI precisa dizer isso.
 * A competência só ecoa na resposta: o conjunto de alvos não depende dela hoje.
 */
export async function listarAlvosIss(competencia: string): Promise<AlvosIssResposta> {
  const clientes = await listarClientesContabilidade({ ativo: true });
  const resposta: AlvosIssResposta = { competencia, alvos: [], semDocumento: [] };
  for (const c of clientes) {
    if (c.modoCobranca !== 'faixa_faturamento') continue;
    const documento = somenteDigitos(c.cobranca?.pagadorDocumento);
    if (documento.length === 11 || documento.length === 14) {
      resposta.alvos.push({ clienteContabilidadeId: c.id, nome: c.nome, documento });
    } else {
      resposta.semDocumento.push({ clienteContabilidadeId: c.id, nome: c.nome });
    }
  }
  return resposta;
}

/**
 * Valida que todo cliente da execução existe e está em `faixa_faturamento`. Um id desconhecido
 * viraria erro de FK (500) no meio da gravação; aqui vira 422 antes de gravar qualquer coisa.
 */
async function validarClientes(ids: string[]): Promise<void> {
  const clientes = await listarClientesContabilidadePorIds(ids);
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const invalidos = ids.filter((id) => porId.get(id)?.modoCobranca !== 'faixa_faturamento');
  if (invalidos.length > 0) {
    throw new ApiError(
      422,
      'Execução contém clientes inexistentes ou fora do modo faixa de faturamento',
      'CLIENTE_INVALIDO',
      { clienteContabilidadeIds: invalidos },
    );
  }
}

/**
 * Faturamentos LANÇADOS nas competências anteriores, só dos clientes que podem disparar R5
 * (capturado com valor 0 a partir da competência do Emissor Nacional). No caso normal — ninguém
 * com zero — não faz consulta nenhuma.
 */
async function historicoParaR5(input: NovaExecucaoIssInput): Promise<Map<string, number[]>> {
  const historico = new Map<string, number[]>();
  if (input.competencia < COMPETENCIA_INICIO_EMISSOR_NACIONAL) return historico;
  const ids = input.capturas
    .filter((c) => c.status === 'capturado' && c.valorServicosPrestados === 0)
    .map((c) => c.clienteContabilidadeId);
  if (ids.length === 0) return historico;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('clientes_contabilidade_faturamentos')
    .select('cliente_contabilidade_id, faturamento')
    .in('cliente_contabilidade_id', ids)
    .in('competencia', competenciasAnteriores(input.competencia, JANELA_HISTORICO_R5));
  if (error) {
    throw new ApiError(500, 'Falha ao consultar histórico de faturamento', 'DB_ERROR', {
      error: error.message,
    });
  }
  for (const r of data as { cliente_contabilidade_id: string; faturamento: number | string }[]) {
    const lista = historico.get(r.cliente_contabilidade_id) ?? [];
    lista.push(Number(r.faturamento));
    historico.set(r.cliente_contabilidade_id, lista);
  }
  return historico;
}

export function totalizarCapturas(capturas: { status: keyof TotaisExecucaoIss }[]): TotaisExecucaoIss {
  const totais: TotaisExecucaoIss = { capturado: 0, nao_encontrado: 0, sem_escrituracao: 0, erro: 0 };
  for (const c of capturas) totais[c.status] += 1;
  return totais;
}

/**
 * Grava uma rodada do agente: execução + capturas (com alertas R5) + ciências. Não é
 * transacional (PostgREST não abre transação entre dois inserts): se as capturas falharem, a
 * execução é apagada — melhor nenhuma execução do que uma execução vazia que a UI mostraria como
 * "0 capturados". O agente guarda o JSON localmente e reenvia.
 */
export async function registrarExecucaoIss(input: NovaExecucaoIssInput): Promise<ExecucaoIssRegistrada> {
  await validarClientes(input.capturas.map((c) => c.clienteContabilidadeId));
  const historico = await historicoParaR5(input);
  const totais = totalizarCapturas(input.capturas);

  const db = getSupabaseAdmin();
  const { data: execucao, error: errExec } = await db
    .from('iss_execucoes_agente')
    .insert({
      competencia: input.competencia,
      iniciado_em: input.iniciadoEm,
      finalizado_em: input.finalizadoEm,
      maquina: input.maquina,
      versao_agente: input.versaoAgente,
      totais,
      ciencias: input.ciencias,
    })
    .select('id')
    .single();
  if (errExec || !execucao) {
    throw new ApiError(500, 'Falha ao registrar execução do agente ISS', 'DB_ERROR', {
      error: errExec?.message,
    });
  }
  const execucaoId = (execucao as { id: string }).id;

  let comAlerta = 0;
  const linhas = input.capturas.map((c) => {
    const alertas = alertasDaCapturaIss(
      { competencia: input.competencia, status: c.status, valorServicosPrestados: c.valorServicosPrestados },
      historico.get(c.clienteContabilidadeId) ?? [],
    );
    if (alertas.length > 0) comAlerta += 1;
    return {
      execucao_id: execucaoId,
      cliente_contabilidade_id: c.clienteContabilidadeId,
      competencia: input.competencia,
      status: c.status,
      valor_servicos_prestados: c.valorServicosPrestados,
      quantidade_notas: c.quantidadeNotas,
      situacao_iss: c.situacaoIss,
      competencia_fechada: c.competenciaFechada,
      inscricao_municipal: c.inscricaoMunicipal,
      razao_social_iss: c.razaoSocialIss,
      alertas,
      mensagem_erro: c.mensagemErro,
      capturado_em: c.capturadoEm,
    };
  });

  const { error: errCapturas } = await db.from('iss_capturas').insert(linhas);
  if (errCapturas) {
    await db.from('iss_execucoes_agente').delete().eq('id', execucaoId);
    throw new ApiError(500, 'Falha ao registrar capturas do agente ISS', 'DB_ERROR', {
      error: errCapturas.message,
    });
  }

  return { execucaoId, competencia: input.competencia, totais, comAlerta };
}

/**
 * Proposta vigente por cliente na competência = captura MAIS RECENTE (capturas são append-only:
 * reexecutar o agente no mesmo mês não apaga o que foi lido antes). Consumida pela Story 13.3.
 */
export async function listarPropostasIssVigentes(competencia: string): Promise<CapturaIss[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('iss_capturas')
    .select('*')
    .eq('competencia', competencia)
    .order('capturado_em', { ascending: false });
  if (error) {
    throw new ApiError(500, 'Falha ao listar capturas do ISS', 'DB_ERROR', { error: error.message });
  }
  const vigentes = new Map<string, CapturaIss>();
  for (const row of data as IssCapturaRow[]) {
    if (!vigentes.has(row.cliente_contabilidade_id)) {
      vigentes.set(row.cliente_contabilidade_id, toCapturaIss(row));
    }
  }
  return [...vigentes.values()];
}

/** Execução mais recente do agente na competência (faixa-resumo do diálogo de lote — Story 13.3). */
export async function buscarUltimaExecucaoIss(competencia: string): Promise<UltimaExecucaoIss | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('iss_execucoes_agente')
    .select('id, competencia, iniciado_em, finalizado_em, totais')
    .eq('competencia', competencia)
    .order('iniciado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao buscar a última execução do agente ISS', 'DB_ERROR', {
      error: error.message,
    });
  }
  if (!data) return null;
  const row = data as {
    id: string;
    competencia: string;
    iniciado_em: string;
    finalizado_em: string | null;
    totais: Partial<TotaisExecucaoIss> | null;
  };
  return {
    id: row.id,
    competencia: row.competencia,
    iniciadoEm: row.iniciado_em,
    finalizadoEm: row.finalizado_em,
    totais: {
      capturado: row.totais?.capturado ?? 0,
      nao_encontrado: row.totais?.nao_encontrado ?? 0,
      sem_escrituracao: row.totais?.sem_escrituracao ?? 0,
      erro: row.totais?.erro ?? 0,
    },
  };
}

/**
 * Capturas por id — usado pelo lançamento em lote para CONFERIR, no servidor, que o valor que o
 * operador aceitou é mesmo o da captura citada antes de gravar `origem = 'iss_fortaleza'`.
 */
export async function buscarCapturasIssPorIds(ids: string[]): Promise<CapturaIss[]> {
  if (ids.length === 0) return [];
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('iss_capturas').select('*').in('id', ids);
  if (error) {
    throw new ApiError(500, 'Falha ao buscar capturas do ISS', 'DB_ERROR', { error: error.message });
  }
  return (data as IssCapturaRow[]).map(toCapturaIss);
}
