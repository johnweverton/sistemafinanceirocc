// Lote Emissao Repository — única porta de leitura/escrita de lotes_emissao e
// lote_emissao_itens (migration 0038, revisão de arquitetura 2026-07-31, decisão 5). Mesmo
// padrão de execucao-repository.ts. Toda escrita é via service role (bypassa RLS) — as
// policies só permitem leitura a admin/financeiro.
import type { ContaEmissora, LoteEmissao, LoteEmissaoItem, StatusItemLoteEmissao } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toLoteEmissao,
  toLoteEmissaoItem,
  type LoteEmissaoRow,
  type LoteEmissaoItemRow,
} from './mappers';

export interface NovoItemLote {
  execucaoResultadoId: string;
  contaEmissora: ContaEmissora | null;
  valorSnapshot: number;
  status: StatusItemLoteEmissao;
  codigoErro?: string | null;
  mensagemErro?: string | null;
}

/** Cria o cabeçalho do lote (status inicial 'aguardando_confirmacao') e seus itens (aceitos E
 *  recusados — um item recusado no preview fica com status 'pulado' e um motivo, não some da
 *  tela). Ambos na mesma chamada porque um lote sem nenhum item não faz sentido existir. */
export async function criarLoteComItens(params: {
  escopoTipo: LoteEmissao['escopoTipo'];
  escopoRef: string;
  criadoPor: string;
  snapshotTotalItens: number;
  snapshotTotalValor: number;
  itens: NovoItemLote[];
}): Promise<LoteEmissao> {
  const db = getSupabaseAdmin();
  const { data: lote, error: errLote } = await db
    .from('lotes_emissao')
    .insert({
      escopo_tipo: params.escopoTipo,
      escopo_ref: params.escopoRef,
      criado_por: params.criadoPor,
      snapshot_total_itens: params.snapshotTotalItens,
      snapshot_total_valor: params.snapshotTotalValor,
    })
    .select('*')
    .single();
  if (errLote) throw new ApiError(500, 'Falha ao criar lote de emissão', 'DB_ERROR', { error: errLote.message });

  const loteId = (lote as LoteEmissaoRow).id;

  if (params.itens.length > 0) {
    const { error: errItens } = await db.from('lote_emissao_itens').insert(
      params.itens.map((i) => ({
        lote_id: loteId,
        execucao_resultado_id: i.execucaoResultadoId,
        conta_emissora: i.contaEmissora,
        valor_snapshot: i.valorSnapshot,
        status: i.status,
        codigo_erro: i.codigoErro ?? null,
        mensagem_erro: i.mensagemErro ?? null,
      })),
    );
    if (errItens) {
      // QA-style (mesmo espírito de criarExecucao): sem os itens o lote nunca processa nada —
      // marca erro em vez de deixar um registro zumbi em 'aguardando_confirmacao'.
      await db.from('lotes_emissao').update({ status: 'cancelado', finalizado_em: new Date().toISOString() }).eq('id', loteId);
      throw new ApiError(500, 'Falha ao inserir itens do lote. Lote cancelado', 'DB_ERROR', {
        error: errItens.message,
      });
    }
  }

  return toLoteEmissao(lote as LoteEmissaoRow);
}

export async function buscarLote(id: string): Promise<LoteEmissao | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('lotes_emissao').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar lote de emissão', 'DB_ERROR', { error: error.message });
  return data ? toLoteEmissao(data as LoteEmissaoRow) : null;
}

export async function listarItensLote(loteId: string): Promise<LoteEmissaoItem[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('lote_emissao_itens')
    .select('*')
    .eq('lote_id', loteId)
    .order('id', { ascending: true });
  if (error) throw new ApiError(500, 'Falha ao listar itens do lote', 'DB_ERROR', { error: error.message });
  return (data as LoteEmissaoItemRow[]).map(toLoteEmissaoItem);
}

/** Até `limite` itens ainda pendentes — cursor natural: itens processados saem do filtro
 *  `status='pendente'`, então cada chamada avança sozinha sem precisar de offset/contagem. */
export async function listarItensPendentes(loteId: string, limite: number): Promise<LoteEmissaoItem[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('lote_emissao_itens')
    .select('*')
    .eq('lote_id', loteId)
    .eq('status', 'pendente')
    .order('id', { ascending: true })
    .limit(limite);
  if (error) throw new ApiError(500, 'Falha ao listar itens pendentes do lote', 'DB_ERROR', { error: error.message });
  return (data as LoteEmissaoItemRow[]).map(toLoteEmissaoItem);
}

export interface ContagensLote {
  pendente: number;
  emitido: number;
  pulado: number;
  /** Falhas de GATEWAY (codigo_erro = 'FALHA_GATEWAY') — as únicas que alimentam o circuit
   *  breaker (taxa de falha). Falha de dado de cadastro (ex. COBRANCA_INCOMPLETA) não conta:
   *  "é dado ruim de um cadastro, não sinal de nada" (revisão de arquitetura, decisão 2). */
  falhaGateway: number;
  falhaOutra: number;
}

async function contar(db: ReturnType<typeof getSupabaseAdmin>, loteId: string, filtro: Record<string, string>): Promise<number> {
  let query = db.from('lote_emissao_itens').select('id', { count: 'exact', head: true }).eq('lote_id', loteId);
  for (const [campo, valor] of Object.entries(filtro)) query = query.eq(campo, valor);
  const { count, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao contar itens do lote', 'DB_ERROR', { error: error.message });
  return count ?? 0;
}

export async function contarItensPorStatus(loteId: string): Promise<ContagensLote> {
  const db = getSupabaseAdmin();
  const [pendente, emitido, pulado, falhaGateway, falhaTotal] = await Promise.all([
    contar(db, loteId, { status: 'pendente' }),
    contar(db, loteId, { status: 'emitido' }),
    contar(db, loteId, { status: 'pulado' }),
    contar(db, loteId, { status: 'falha', codigo_erro: 'FALHA_GATEWAY' }),
    contar(db, loteId, { status: 'falha' }),
  ]);
  return { pendente, emitido, pulado, falhaGateway, falhaOutra: falhaTotal - falhaGateway };
}

export interface AtualizarItemLoteParams {
  status: StatusItemLoteEmissao;
  codigoErro?: string | null;
  mensagemErro?: string | null;
  boletoId?: string | null;
}

export async function atualizarItemLote(itemId: string, params: AtualizarItemLoteParams): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('lote_emissao_itens')
    .update({
      status: params.status,
      codigo_erro: params.codigoErro ?? null,
      mensagem_erro: params.mensagemErro ?? null,
      boleto_id: params.boletoId ?? null,
      processado_em: new Date().toISOString(),
    })
    .eq('id', itemId);
  if (error) throw new ApiError(500, 'Falha ao atualizar item do lote', 'DB_ERROR', { error: error.message });
}

/**
 * Transição 'aguardando_confirmacao' → 'processando', atômica via WHERE na condição atual —
 * se outra requisição já confirmou (ou o lote expirou) nesse meio-tempo, o UPDATE não casa
 * nenhuma linha e devolve `null` (o chamador decide o que fazer, sem corrida).
 */
export async function confirmarLote(id: string, confirmadoPor: string): Promise<LoteEmissao | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('lotes_emissao')
    .update({ status: 'processando', confirmado_por: confirmadoPor, confirmado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'aguardando_confirmacao')
    .select('*')
    .maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao confirmar lote', 'DB_ERROR', { error: error.message });
  return data ? toLoteEmissao(data as LoteEmissaoRow) : null;
}

/** Marca o lote como expirado — transição condicional (só de 'aguardando_confirmacao'). */
export async function expirarLote(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('lotes_emissao')
    .update({ status: 'expirado', finalizado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'aguardando_confirmacao');
  if (error) throw new ApiError(500, 'Falha ao expirar lote', 'DB_ERROR', { error: error.message });
}

export async function atualizarProgressoLote(
  id: string,
  params: { progresso: number; falhasConsecutivas: number },
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('lotes_emissao')
    .update({
      progresso: Math.min(100, Math.max(0, Math.round(params.progresso))),
      falhas_consecutivas: params.falhasConsecutivas,
    })
    .eq('id', id);
  if (error) throw new ApiError(500, 'Falha ao atualizar progresso do lote', 'DB_ERROR', { error: error.message });
}

/** Pausa o lote pelo circuit breaker — só sai daqui via `retomarLote` (POST .../retomar). */
export async function pausarLotePorFalhas(
  id: string,
  params: { motivoPausa: string; falhasConsecutivas: number },
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('lotes_emissao')
    .update({ status: 'pausado_por_falhas', motivo_pausa: params.motivoPausa, falhas_consecutivas: params.falhasConsecutivas })
    .eq('id', id);
  if (error) throw new ApiError(500, 'Falha ao pausar lote', 'DB_ERROR', { error: error.message });
}

/** Retoma um lote pausado — reseta o contador de falhas consecutivas (tentativa nova, mesmo
 *  espírito de `retomar` de execução: o cursor vem do banco, então é sempre seguro). Transição
 *  condicional (só de 'pausado_por_falhas'); `null` se já não estiver mais pausado. */
export async function retomarLote(id: string): Promise<LoteEmissao | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('lotes_emissao')
    .update({ status: 'processando', falhas_consecutivas: 0, motivo_pausa: null })
    .eq('id', id)
    .eq('status', 'pausado_por_falhas')
    .select('*')
    .maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao retomar lote', 'DB_ERROR', { error: error.message });
  return data ? toLoteEmissao(data as LoteEmissaoRow) : null;
}

export interface TotaisLote {
  totalEmitidos: number;
  totalPulados: number;
  totalFalhas: number;
  totalValorEmitido: number;
}

export async function concluirLote(id: string, totais: TotaisLote): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('lotes_emissao')
    .update({
      status: 'concluido',
      progresso: 100,
      finalizado_em: new Date().toISOString(),
      total_emitidos: totais.totalEmitidos,
      total_pulados: totais.totalPulados,
      total_falhas: totais.totalFalhas,
      total_valor_emitido: totais.totalValorEmitido,
    })
    .eq('id', id);
  if (error) throw new ApiError(500, 'Falha ao concluir lote', 'DB_ERROR', { error: error.message });
}

/** Soma o valor efetivamente emitido no lote (itens com status 'emitido') — usado ao concluir. */
export async function somarValorEmitido(loteId: string): Promise<number> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('lote_emissao_itens')
    .select('valor_snapshot')
    .eq('lote_id', loteId)
    .eq('status', 'emitido');
  if (error) throw new ApiError(500, 'Falha ao somar valor emitido do lote', 'DB_ERROR', { error: error.message });
  return (data as { valor_snapshot: number }[]).reduce((acc, r) => acc + Number(r.valor_snapshot), 0);
}
