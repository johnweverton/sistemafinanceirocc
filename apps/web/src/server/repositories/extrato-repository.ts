// Extrato Repository — persistência do snapshot do extrato bancário (Story 8.1, Épico 8).
// Escrita via service role (server-side). Três responsabilidades, consumidas pela 8.2:
//   1. Upsert IDEMPOTENTE do sync: re-sincronizar um período atualiza os dados bancários
//      sem duplicar (UNIQUE conta+entry_id) e NUNCA regride o status de conciliação —
//      as colunas de conciliação não entram no payload do upsert.
//   2. Listagem com filtros (conta/período/status/tipo) — página /extrato e fila (8.3).
//   3. Transições de status com trilha (conciliado_por/conciliado_em) — todas reversíveis.
import type {
  ContaEmissora,
  ExtratoTransacao,
  ExtratoSync,
  FiltroExtrato,
  FiltroListagemExtrato,
  StatusConciliacao,
  StatusCategorizacao,
  TransacaoExtratoApi,
} from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import { toExtratoTransacao, type ExtratoTransacaoRow } from './mappers';
import type { TransicaoConciliacao } from '@/server/engine/conciliacao';

export interface ResultadoUpsertExtrato {
  qtdNovas: number;
  qtdAtualizadas: number;
}

// QA-811-1: o .in() do PostgREST vira querystring — lotes grandes estouram o limite de URL.
// Selects em lotes de 200 ids; upserts em lotes de 500 linhas (corpo, folga apenas).
const LOTE_SELECT = 200;
const LOTE_UPSERT = 500;

function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Upsert idempotente das transações de um sync (ON CONFLICT conta_emissora+entry_id).
 * O payload NUNCA inclui status_conciliacao/boleto_id/conciliado_* — uma transação já
 * conciliada (auto ou manual) que reaparece no re-sync mantém o estado intacto (AC 6);
 * só os dados BANCÁRIOS são atualizados.
 */
export async function upsertTransacoes(
  conta: ContaEmissora,
  transacoes: TransacaoExtratoApi[],
): Promise<ResultadoUpsertExtrato> {
  if (transacoes.length === 0) return { qtdNovas: 0, qtdAtualizadas: 0 };
  const db = getSupabaseAdmin();

  // Descobre o que já existe ANTES do upsert para contabilizar novas × atualizadas
  // (o upsert do PostgREST não distingue insert de update no retorno).
  const entryIds = transacoes.map((t) => t.entryId);
  const jaExistem = new Set<string>();
  for (const lote of emLotes(entryIds, LOTE_SELECT)) {
    const { data: existentes, error: erroSelect } = await db
      .from('extrato_transacoes')
      .select('entry_id')
      .eq('conta_emissora', conta)
      .in('entry_id', lote);
    if (erroSelect) {
      throw new ApiError(500, 'Falha ao consultar transações existentes do extrato', 'DB_ERROR', {
        error: erroSelect.message,
      });
    }
    for (const r of existentes ?? []) jaExistem.add((r as { entry_id: string }).entry_id);
  }

  const agora = new Date().toISOString();
  const rows = transacoes.map((t) => ({
    conta_emissora: conta,
    entry_id: t.entryId,
    tipo: t.tipo,
    transaction_type: t.transactionType,
    valor: t.valor,
    descricao: t.descricao,
    contraparte_nome: t.contraparteNome,
    contraparte_documento: t.contraparteDocumento,
    data_transacao: t.dataTransacao,
    payload: t.payload,
    sincronizado_em: agora,
  }));

  for (const lote of emLotes(rows, LOTE_UPSERT)) {
    const { error: erroUpsert } = await db
      .from('extrato_transacoes')
      .upsert(lote, { onConflict: 'conta_emissora,entry_id' });
    if (erroUpsert) {
      throw new ApiError(500, 'Falha ao gravar transações do extrato', 'DB_ERROR', {
        error: erroUpsert.message,
      });
    }
  }

  const qtdNovas = transacoes.filter((t) => !jaExistem.has(t.entryId)).length;
  return { qtdNovas, qtdAtualizadas: transacoes.length - qtdNovas };
}

/** Registra a execução de um sync no log (auditoria + janela do próximo sync). */
export async function registrarSync(
  conta: ContaEmissora,
  periodo: FiltroExtrato,
  resultado: ResultadoUpsertExtrato,
  executadoPor: string | null,
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from('extrato_syncs').insert({
    conta_emissora: conta,
    periodo_inicio: periodo.inicio,
    periodo_fim: periodo.fim,
    qtd_novas: resultado.qtdNovas,
    qtd_atualizadas: resultado.qtdAtualizadas,
    executado_por: executadoPor,
  });
  if (error) {
    throw new ApiError(500, 'Falha ao registrar sync do extrato', 'DB_ERROR', {
      error: error.message,
    });
  }
}

/** Último sync da conta (define a janela do próximo, com overlap de 3 dias — D3). */
export async function ultimoSync(conta: ContaEmissora): Promise<ExtratoSync | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('extrato_syncs')
    .select('*')
    .eq('conta_emissora', conta)
    .order('executado_em', { ascending: false })
    .limit(1);
  if (error) {
    throw new ApiError(500, 'Falha ao consultar último sync do extrato', 'DB_ERROR', {
      error: error.message,
    });
  }
  const row = (data ?? [])[0] as
    | {
        id: string;
        conta_emissora: ContaEmissora;
        periodo_inicio: string;
        periodo_fim: string;
        qtd_novas: number;
        qtd_atualizadas: number;
        executado_por: string | null;
        executado_em: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    contaEmissora: row.conta_emissora,
    periodoInicio: row.periodo_inicio,
    periodoFim: row.periodo_fim,
    qtdNovas: row.qtd_novas,
    qtdAtualizadas: row.qtd_atualizadas,
    executadoPor: row.executado_por,
    executadoEm: row.executado_em,
  };
}

/** Lista transações do snapshot com filtros opcionais, mais recentes primeiro. */
export async function listarTransacoes(
  filtros: FiltroListagemExtrato = {},
): Promise<ExtratoTransacao[]> {
  const db = getSupabaseAdmin();
  let query = db
    .from('extrato_transacoes')
    .select('*')
    .order('data_transacao', { ascending: false });

  if (filtros.contaEmissora) query = query.eq('conta_emissora', filtros.contaEmissora);
  if (filtros.dataInicio) query = query.gte('data_transacao', filtros.dataInicio);
  if (filtros.dataFim) query = query.lte('data_transacao', filtros.dataFim);
  if (filtros.status) query = query.eq('status_conciliacao', filtros.status);
  if (filtros.tipo) query = query.eq('tipo', filtros.tipo);

  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, 'Falha ao listar transações do extrato', 'DB_ERROR', {
      error: error.message,
    });
  }
  return (data as ExtratoTransacaoRow[]).map(toExtratoTransacao);
}

/** Ids dos boletos já vinculados a uma transação conciliada — exclui candidatos da UI (8.3). */
export async function boletoIdsConciliados(): Promise<Set<string>> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('extrato_transacoes')
    .select('boleto_id')
    .like('status_conciliacao', 'conciliado%')
    .not('boleto_id', 'is', null);
  if (error) {
    throw new ApiError(500, 'Falha ao listar boletos conciliados', 'DB_ERROR', {
      error: error.message,
    });
  }
  return new Set((data ?? []).map((r) => (r as { boleto_id: string }).boleto_id));
}

/** Busca uma transação do snapshot por id; null se não existe. */
export async function buscarTransacao(id: string): Promise<ExtratoTransacao | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('extrato_transacoes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao buscar transação do extrato', 'DB_ERROR', {
      error: error.message,
    });
  }
  return data ? toExtratoTransacao(data as ExtratoTransacaoRow) : null;
}

/**
 * Créditos da conta em estado recalculável (sem_match/sugerido) — entrada do motor de
 * matching (Story 8.2). Estados manuais nunca entram (o engine também os filtra: defesa dupla).
 */
export async function listarCreditosParaMatching(
  conta: ContaEmissora,
): Promise<ExtratoTransacao[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('extrato_transacoes')
    .select('*')
    .eq('conta_emissora', conta)
    .eq('tipo', 'CREDIT')
    .in('status_conciliacao', ['sem_match', 'sugerido']);
  if (error) {
    throw new ApiError(500, 'Falha ao listar créditos para matching', 'DB_ERROR', {
      error: error.message,
    });
  }
  return (data as ExtratoTransacaoRow[]).map(toExtratoTransacao);
}

/**
 * Aplica as transições do motor com updates CONDICIONAIS: o WHERE exige que o status atual
 * ainda seja recalculável (sem_match/sugerido) — uma ação manual concorrente (conciliar/
 * ignorar entre a leitura e a escrita) vence e a transição do motor é descartada (mitigação
 * de corrida da story). Corrida no UNIQUE parcial do boleto (23505) também descarta a
 * transição em vez de falhar o sync.
 */
export async function aplicarTransicoesConciliacao(
  transicoes: TransicaoConciliacao[],
): Promise<{ aplicadas: number; descartadas: number }> {
  const db = getSupabaseAdmin();
  let aplicadas = 0;
  let descartadas = 0;

  for (const tr of transicoes) {
    const patch: Record<string, unknown> =
      tr.status === 'conciliado_auto'
        ? {
            status_conciliacao: 'conciliado_auto',
            boleto_id: tr.boletoId,
            conciliado_por: null, // ação do sistema
            conciliado_em: new Date().toISOString(),
          }
        : {
            // sugerido guarda o candidato; sem_match limpa. Nenhum dos dois tem trilha humana.
            status_conciliacao: tr.status,
            boleto_id: tr.status === 'sugerido' ? tr.boletoId : null,
            conciliado_por: null,
            conciliado_em: null,
          };

    const { data, error } = await db
      .from('extrato_transacoes')
      .update(patch)
      .eq('id', tr.transacaoId)
      .in('status_conciliacao', ['sem_match', 'sugerido'])
      .select('id');

    if (error) {
      if (error.code === '23505') {
        // Boleto foi conciliado com outra transação no meio do caminho — descarta o auto.
        descartadas++;
        continue;
      }
      throw new ApiError(500, 'Falha ao aplicar transições de conciliação', 'DB_ERROR', {
        error: error.message,
      });
    }
    if ((data ?? []).length > 0) aplicadas++;
    else descartadas++; // status mudou por ação manual concorrente — manual vence
  }

  return { aplicadas, descartadas };
}

export interface MudancaConciliacao {
  status: StatusConciliacao;
  /** Obrigatório em conciliado_*; a sugestão (sugerido) também aponta o candidato. */
  boletoId?: string | null;
  /** Quem executou a ação (profiles.id); null/ausente em ações do sistema (auto). */
  usuarioId?: string | null;
}

/**
 * Transição de status de conciliação com trilha (AC 6) — consumida pelas ações da 8.2
 * (conciliar/ignorar/desfazer) e pelo motor de matching:
 *   - conciliado_auto/manual: exige boletoId; grava conciliado_em; conciliado_por = usuário
 *     (null no auto — ação do sistema).
 *   - sugerido: guarda o boleto candidato SEM trilha humana (ninguém decidiu ainda).
 *   - ignorado: sem boleto; trilha de quem ignorou.
 *   - sem_match (desfazer): limpa vínculo e trilha — tudo reversível (D2).
 */
export async function atualizarStatusConciliacao(
  id: string,
  mudanca: MudancaConciliacao,
): Promise<ExtratoTransacao> {
  const patch: Record<string, unknown> = { status_conciliacao: mudanca.status };

  if (mudanca.status === 'conciliado_auto' || mudanca.status === 'conciliado_manual') {
    if (!mudanca.boletoId) {
      throw new ApiError(400, 'Conciliação exige o boleto vinculado (boletoId)', 'VALIDATION_ERROR');
    }
    patch.boleto_id = mudanca.boletoId;
    patch.conciliado_por = mudanca.usuarioId ?? null;
    patch.conciliado_em = new Date().toISOString();
  } else if (mudanca.status === 'sugerido') {
    patch.boleto_id = mudanca.boletoId ?? null;
    patch.conciliado_por = null;
    patch.conciliado_em = null;
  } else if (mudanca.status === 'ignorado') {
    patch.boleto_id = null;
    patch.conciliado_por = mudanca.usuarioId ?? null;
    patch.conciliado_em = new Date().toISOString();
  } else {
    // sem_match = desfazer: limpa vínculo e trilha.
    patch.boleto_id = null;
    patch.conciliado_por = null;
    patch.conciliado_em = null;
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('extrato_transacoes')
    .update(patch)
    .eq('id', id)
    .select('*');
  if (error) {
    // OBS-812 (gate 8.1): violação do UNIQUE parcial = boleto já conciliado com outra
    // transação — erro de NEGÓCIO (409), não de infraestrutura.
    if (error.code === '23505') {
      throw new ApiError(
        409,
        'Boleto já está conciliado com outra transação do extrato.',
        'BOLETO_JA_CONCILIADO',
        { boletoId: mudanca.boletoId },
      );
    }
    throw new ApiError(500, 'Falha ao atualizar status de conciliação', 'DB_ERROR', {
      error: error.message,
    });
  }
  const row = (data ?? [])[0] as ExtratoTransacaoRow | undefined;
  if (!row) {
    throw new ApiError(404, 'Transação do extrato não encontrada', 'NOT_FOUND', { id });
  }
  return toExtratoTransacao(row);
}

export interface Categorizacao {
  categoriaId: string;
  status: StatusCategorizacao;
}

/**
 * Grava categoria/status de categorização (Épico 9, D2) — eixo INDEPENDENTE de
 * status_conciliacao: uma transação pode estar conciliada e sem categoria ao mesmo tempo.
 * Consumida pelo motor de categorização e pela confirmação manual (9.2).
 */
export async function categorizarTransacao(
  id: string,
  categorizacao: Categorizacao,
): Promise<ExtratoTransacao> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('extrato_transacoes')
    .update({ categoria_id: categorizacao.categoriaId, status_categorizacao: categorizacao.status })
    .eq('id', id)
    .select('*');
  if (error) {
    throw new ApiError(500, 'Falha ao categorizar transação do extrato', 'DB_ERROR', {
      error: error.message,
    });
  }
  const row = (data ?? [])[0] as ExtratoTransacaoRow | undefined;
  if (!row) {
    throw new ApiError(404, 'Transação do extrato não encontrada', 'NOT_FOUND', { id });
  }
  return toExtratoTransacao(row);
}
