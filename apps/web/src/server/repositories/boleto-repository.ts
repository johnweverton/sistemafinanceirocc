// Boleto Repository — única porta de leitura/escrita da tabela boletos.
// Segue o mesmo padrão do medico-repository e execucao-repository.
// Toda escrita via service role (bypassa RLS).
import type { Boleto, BoletoEvento, ContaEmissora, GatewayBoleto, StatusBoleto } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import { toBoleto, toBoletoEvento, type BoletoRow, type BoletoEventoRow } from './mappers';

export interface ReservarBoletoParams {
  execucaoResultadoId: string;
  gateway: GatewayBoleto;
  emitidoPor: string;
  /** Conta que emitirá o boleto (Épico 7). Omitida → default 'mc' do banco (pré-7.2/pré-migration). */
  contaEmissora?: ContaEmissora;
  /** Lote de emissão que originou esta reserva (migration 0038); omitido/null = emissão manual. */
  loteId?: string | null;
}

/**
 * Reserva a linha do boleto com status 'processando' ANTES de chamar o gateway
 * (migration 0037 — Achados 1/2 da revisão de arquitetura do lote). O índice único parcial
 * `uq_boletos_resultado_ativo` é a barreira REAL contra corrida: duas reservas concorrentes
 * para o mesmo `execucaoResultadoId` não podem coexistir — a segunda vira 23505 aqui, traduzido
 * em 409 nomeado, em vez de deixar dois workers emitirem dois boletos reais na Cora.
 * O `id` devolvido vira a Idempotency-Key determinística enviada ao gateway.
 */
export async function reservarBoleto(params: ReservarBoletoParams): Promise<Boleto> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .insert({
      execucao_resultado_id: params.execucaoResultadoId,
      gateway: params.gateway,
      status: 'processando' satisfies StatusBoleto,
      emitido_por: params.emitidoPor,
      // Só envia a coluna quando informada: em banco pré-migration 0021 o insert
      // continua válido, e com a migration o default 'mc' cobre a omissão.
      ...(params.contaEmissora ? { conta_emissora: params.contaEmissora } : {}),
      lote_id: params.loteId ?? null,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new ApiError(
        409,
        'Já existe um boleto em processamento ou emitido para este resultado.',
        'BOLETO_JA_EMITIDO',
      );
    }
    throw new ApiError(500, 'Falha ao reservar boleto', 'DB_ERROR', { error: error.message });
  }
  return toBoleto(data as BoletoRow);
}

export interface FinalizarBoletoParams {
  status: StatusBoleto; // 'emitido' | 'falha' — resultado real devolvido pelo gateway
  idExterno: string | null;
  payloadResposta: unknown;
  vencimento?: string | null; // AAAA-MM-DD — mesma data do payment_terms (Story 4.2)
}

/** Atualiza a reserva (ver `reservarBoleto`) com o resultado real do gateway. */
export async function finalizarBoleto(id: string, params: FinalizarBoletoParams): Promise<Boleto> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .update({
      status: params.status,
      id_externo: params.idExterno,
      payload_resposta: params.payloadResposta,
      vencimento: params.vencimento ?? null,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao finalizar boleto', 'DB_ERROR', { error: error.message });
  return toBoleto(data as BoletoRow);
}

/** Busca um boleto pelo ID interno. */
export async function buscarBoleto(id: string): Promise<Boleto | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new ApiError(500, 'Falha ao buscar boleto por ID', 'DB_ERROR', { error: error.message });
  }
  return data ? toBoleto(data as BoletoRow) : null;
}

/** Busca um boleto pelo id externo do gateway (invoice id da Cora). */
export async function buscarBoletoPorIdExterno(idExterno: string): Promise<Boleto | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('*')
    .eq('id_externo', idExterno)
    .order('emitido_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar boleto por id externo', 'DB_ERROR', { error: error.message });
  return data ? toBoleto(data as BoletoRow) : null;
}

export interface BoletoParaLembrete {
  boletoId: string;
  execucaoResultadoId: string;
  vencimento: string; // AAAA-MM-DD
  payloadResposta: unknown; // para extrair o pdfUrl (payment_options.bank_slip.url)
}

/**
 * Boletos que vencem em `dataReferencia` (AAAA-MM-DD) e ainda estão em aberto — candidatos ao
 * lembrete preventivo D-1 (Épico 13, Fase 1). `status='emitido'` (não 'pago'/'cancelado'/'falha'/
 * 'processando') + `pago_em is null` é redundante em teoria (um boleto 'emitido' nunca tem
 * pago_em preenchido — a baixa muda o status para 'pago'), mas mantido como defesa explícita
 * contra pegar um boleto que a baixa já processou entre a leitura e o disparo (corrida rara).
 * `dataReferencia` é injetada pelo chamador (não calculada aqui) para isolar o cálculo de fuso
 * horário ("amanhã" em America/Sao_Paulo) na rota do cron, longe do repositório.
 */
export async function listarBoletosVencendoEm(dataReferencia: string): Promise<BoletoParaLembrete[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('id, execucao_resultado_id, vencimento, payload_resposta')
    .eq('status', 'emitido')
    .eq('vencimento', dataReferencia)
    .is('pago_em', null);
  if (error) {
    throw new ApiError(500, 'Falha ao listar boletos vencendo para lembrete', 'DB_ERROR', { error: error.message });
  }
  return (data ?? []).map((r) => ({
    boletoId: r.id as string,
    execucaoResultadoId: r.execucao_resultado_id as string,
    vencimento: r.vencimento as string,
    payloadResposta: r.payload_resposta,
  }));
}

export interface RegistrarEventoParams {
  boletoId?: string | null;
  idExterno: string | null;
  eventoId: string | null;
  eventoTipo: string | null;
  statusReconsultado?: string | null;
  payload: unknown;
}

/**
 * Registra um evento de webhook do Cora de forma IDEMPOTENTE: se `eventoId` já existe, devolve o
 * registro existente com `novo=false` (o chamador não deve reprocessar). Retorna `novo=true` quando
 * o evento é inédito.
 */
export async function registrarEvento(
  params: RegistrarEventoParams,
): Promise<{ evento: BoletoEvento; novo: boolean }> {
  const db = getSupabaseAdmin();

  // Dedupe: se o evento já foi visto, devolve o existente.
  if (params.eventoId) {
    const { data: existente } = await db
      .from('boleto_eventos')
      .select('*')
      .eq('evento_id', params.eventoId)
      .maybeSingle();
    if (existente) return { evento: toBoletoEvento(existente as BoletoEventoRow), novo: false };
  }

  const { data, error } = await db
    .from('boleto_eventos')
    .insert({
      boleto_id: params.boletoId ?? null,
      id_externo: params.idExterno,
      evento_id: params.eventoId,
      evento_tipo: params.eventoTipo,
      status_reconsultado: params.statusReconsultado ?? null,
      payload: params.payload,
    })
    .select('*')
    .single();

  if (error) {
    // Corrida: violação de unicidade → o evento foi inserido concorrentemente; busca o existente.
    if (error.code === '23505' && params.eventoId) {
      const { data: e } = await db
        .from('boleto_eventos')
        .select('*')
        .eq('evento_id', params.eventoId)
        .maybeSingle();
      if (e) return { evento: toBoletoEvento(e as BoletoEventoRow), novo: false };
    }
    throw new ApiError(500, 'Falha ao registrar evento de boleto', 'DB_ERROR', { error: error.message });
  }
  return { evento: toBoletoEvento(data as BoletoEventoRow), novo: true };
}

export interface RegistrarBaixaParams {
  status: StatusBoleto; // 'pago' | 'cancelado'
  pagoEm: string | null;
  valorPago: number | null;
}

/**
 * Aplica a baixa em um boleto identificado por `id_externo`. Não falha se nenhum boleto casar
 * (evento órfão) — devolve `atualizado=false`. Seta `atualizado_em`.
 */
export async function registrarBaixa(
  idExterno: string,
  params: RegistrarBaixaParams,
): Promise<{ atualizado: boolean; boleto: Boleto | null }> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .update({
      status: params.status,
      pago_em: params.pagoEm,
      valor_pago: params.valorPago,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id_externo', idExterno)
    .select('*');
  if (error) throw new ApiError(500, 'Falha ao registrar baixa do boleto', 'DB_ERROR', { error: error.message });
  const rows = (data ?? []) as BoletoRow[];
  if (rows.length === 0) return { atualizado: false, boleto: null };
  return { atualizado: true, boleto: toBoleto(rows[0]!) };
}

/**
 * Verifica se já existe boleto ATIVO para um resultado (idempotência da emissão).
 * Story 6.1 (AC 3): bloqueiam reemissão os status 'emitido' E 'pago' — antes só 'emitido'
 * era checado, permitindo reemitir sobre resultado já pago (bug latente). 'cancelado' e
 * 'falha' NÃO bloqueiam — são exatamente os casos em que reemitir é legítimo.
 */
export async function buscarBoletoEmitido(execucaoResultadoId: string): Promise<Boleto | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('*')
    .eq('execucao_resultado_id', execucaoResultadoId)
    .in('status', ['emitido', 'pago'])
    .order('emitido_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar boleto', 'DB_ERROR', { error: error.message });
  return data ? toBoleto(data as BoletoRow) : null;
}

/**
 * Médicos que já têm boleto ativo (emitido/pago — mesmo critério de `buscarBoletoEmitido`,
 * Story 6.1 AC 3) para a competência informada, em QUALQUER execução — não só a atual.
 *
 * `buscarBoletoEmitido` só protege contra reemitir sobre a MESMA linha de resultado; não
 * impede uma execução NOVA (individual ou em lote) de gerar uma linha de resultado inédita
 * pro mesmo médico/competência e emitir um segundo boleto duplicado. Achado real (2026-08-04,
 * coordenadora financeira): emitiu alguns médicos individualmente e ia rodar o mesmo mês em
 * lote em seguida — nada detectava que esses médicos já tinham boleto. Esta função fecha essa
 * lacuna: a UI de nova execução usa o resultado pra excluir/avisar sobre médicos já cobertos.
 */
export async function listarMedicosComBoletoAtivo(competencia: string): Promise<Set<string>> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('execucao_resultados!inner(medico_id, execucoes!inner(competencia))')
    .in('status', ['emitido', 'pago'])
    .eq('execucao_resultados.execucoes.competencia', competencia);
  if (error) {
    throw new ApiError(500, 'Falha ao checar médicos com boleto já emitido na competência', 'DB_ERROR', {
      error: error.message,
    });
  }
  const ids = new Set<string>();
  for (const row of (data ?? []) as unknown as { execucao_resultados: { medico_id: string | null } }[]) {
    const medicoId = row.execucao_resultados?.medico_id;
    if (medicoId) ids.add(medicoId);
  }
  return ids;
}

/**
 * Clientes contábeis que já têm boleto ativo (emitido/pago) para a competência informada, em
 * QUALQUER execução — espelho exato de `listarMedicosComBoletoAtivo`, trocando `medico_id` por
 * `cliente_contabilidade_id` (Story 12.3, risco RS-1).
 *
 * Motivo: o cálculo em lote de clientes contábeis (`POST /api/clientes-contabilidade/lote`) cria
 * uma execução NOVA a cada disparo. Rodar o mesmo lote/competência duas vezes (por engano ou em
 * duas sessões) gerava uma segunda linha de resultado inédita pro mesmo cliente e, com ela, um
 * segundo boleto — cobrança duplicada. `buscarBoletoEmitido` não pega esse caso: ele só protege
 * a MESMA linha de resultado.
 *
 * `cancelado` (e `falha`) NÃO contam como já emitido — mesma regra da consulta de médicos. É o
 * que faz "cancelou e vai reemitir corrigido" continuar funcionando sem precisar de opt-in, com
 * o bloqueio duro decidido pelo dono (Cenário A: não existe reemissão legítima na mesma
 * competência sem cancelar a anterior).
 */
export async function listarClientesContabilidadeComBoletoAtivo(competencia: string): Promise<Set<string>> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .select('execucao_resultados!inner(cliente_contabilidade_id, execucoes!inner(competencia))')
    .in('status', ['emitido', 'pago'])
    .eq('execucao_resultados.execucoes.competencia', competencia);
  if (error) {
    throw new ApiError(
      500,
      'Falha ao checar clientes contábeis com boleto já emitido na competência',
      'DB_ERROR',
      { error: error.message },
    );
  }
  const ids = new Set<string>();
  for (const row of (data ?? []) as unknown as {
    execucao_resultados: { cliente_contabilidade_id: string | null };
  }[]) {
    const clienteId = row.execucao_resultados?.cliente_contabilidade_id;
    if (clienteId) ids.add(clienteId);
  }
  return ids;
}

export interface CancelarBoletoParams {
  canceladoPor: string; // profiles.id de quem confirmou
  motivo: string;
}

/**
 * Marca um boleto como cancelado ATIVAMENTE (Story 6.1) com trilha completa de auditoria
 * (quem/quando/por quê). O payload da resposta do gateway vai para boleto_eventos (não
 * sobrescreve payload_resposta da emissão). Chamar SOMENTE após o gateway confirmar.
 */
export async function cancelarBoleto(id: string, params: CancelarBoletoParams): Promise<Boleto> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('boletos')
    .update({
      status: 'cancelado',
      cancelado_em: new Date().toISOString(),
      cancelado_por: params.canceladoPor,
      motivo_cancelamento: params.motivo,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao cancelar boleto', 'DB_ERROR', { error: error.message });
  return toBoleto(data as BoletoRow);
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

// ---------------------------------------------------------------------------
// Conciliação bancária (Story 8.2)
// ---------------------------------------------------------------------------

/** Boleto pago candidato ao matching — shape do motor de conciliação. */
export interface BoletoPagoParaConciliacao {
  boletoId: string;
  valorPago: number | null;
  pagoEm: string | null;
  /** CPF/CNPJ do pagador do médico (medicos.pagador_documento), só dígitos. */
  pagadorDocumento: string | null;
}

/**
 * Boletos PAGOS da conta que ainda não têm transação de extrato conciliada — o outro lado
 * do matching (Story 8.2). Documento do pagador vem do médico via execucao_resultados
 * (mesmo caminho da vw_recebiveis). Boletos já vinculados (UNIQUE parcial da 0022) saem
 * da lista para respeitar o 1↔1.
 */
export async function listarBoletosPagosParaConciliacao(
  conta: ContaEmissora,
): Promise<BoletoPagoParaConciliacao[]> {
  const db = getSupabaseAdmin();

  // Boletos já ocupados por uma transação conciliada (auto ou manual).
  const { data: ocupadosRows, error: erroOcupados } = await db
    .from('extrato_transacoes')
    .select('boleto_id')
    .like('status_conciliacao', 'conciliado%')
    .not('boleto_id', 'is', null);
  if (erroOcupados) {
    throw new ApiError(500, 'Falha ao listar boletos já conciliados', 'DB_ERROR', {
      error: erroOcupados.message,
    });
  }
  const ocupados = new Set(
    (ocupadosRows ?? []).map((r) => (r as { boleto_id: string }).boleto_id),
  );

  const { data, error } = await db
    .from('boletos')
    .select('id, valor_pago, pago_em, execucao_resultados!inner(medicos!inner(pagador_documento))')
    .eq('conta_emissora', conta)
    .eq('status', 'pago');
  if (error) {
    throw new ApiError(500, 'Falha ao listar boletos pagos para conciliação', 'DB_ERROR', {
      error: error.message,
    });
  }

  // Relações to-one podem chegar como objeto ou array de 1 (inferência do PostgREST sem
  // tipos gerados varia) — normaliza os dois shapes antes de mapear.
  type MedicoDoc = { pagador_documento: string | null };
  type ResultadoRel = { medicos: MedicoDoc | MedicoDoc[] | null };
  const umOuPrimeiro = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  return (data ?? [])
    .filter((row) => !ocupados.has((row as { id: string }).id))
    .map((row) => {
      const r = row as unknown as {
        id: string;
        valor_pago: number | null;
        pago_em: string | null;
        execucao_resultados: ResultadoRel | ResultadoRel[] | null;
      };
      const resultado = umOuPrimeiro(r.execucao_resultados);
      const medico = umOuPrimeiro(resultado?.medicos);
      return {
        boletoId: r.id,
        valorPago: r.valor_pago != null ? Number(r.valor_pago) : null,
        pagoEm: r.pago_em,
        pagadorDocumento: medico?.pagador_documento ?? null,
      };
    });
}
