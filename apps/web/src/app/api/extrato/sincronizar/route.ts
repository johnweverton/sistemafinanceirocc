// POST /api/extrato/sincronizar — sincroniza o extrato de UMA conta emissora (Story 8.2).
// D3 da arquitetura: sob demanda (botão por empresa), janela do último sync até hoje com
// OVERLAP de 3 dias (reprocessa idempotente, pega lançamentos tardios); primeira vez = 90 dias.
// Após o upsert, roda o motor de conciliação (D2) e grava o log em extrato_syncs.
//
// Regras:
//   1. Só admin/financeiro, com rate limit (sync encadeia rede externa — 5/min é folgado).
//   2. Conta sem credenciais → 503 CONTA_NAO_CONFIGURADA (padrão 7.3): a outra conta
//      não é afetada; o operador sabe O QUE falta.
//   3. Gateway falhou (Cora fora, janela grande demais…) → 502 SYNC_FALHOU com a razão.
//   4. Idempotência é do repository (AC 5): re-sync não duplica nem regride status.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import { getServerEnv } from '@/lib/env';
import { criarContaGateway } from '@/server/gateway/conta-gateway-factory';
import {
  upsertTransacoes,
  registrarSync,
  ultimoSync,
  listarCreditosParaMatching,
  aplicarTransicoesConciliacao,
  listarTransacoes,
  categorizarTransacao,
} from '@/server/repositories/extrato-repository';
import { listarBoletosPagosParaConciliacao } from '@/server/repositories/boleto-repository';
import { buscarCategoriasSistema, listarRegras } from '@/server/repositories/plano-contas-repository';
import { conciliar, resumirTransicoes } from '@/server/engine/conciliacao';
import { categorizar } from '@/server/engine/categorizacao';
import { CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';

// Sync encadeia token mTLS + N páginas de extrato + upserts; 60s cabe folgado
// (timeout de 10s por chamada mTLS, volume esperado ~centenas de entradas).
export const maxDuration = 60;

const sincronizarLimiter = createRateLimiter('extrato-sincronizar', {
  limit: 5,
  windowMs: 60_000,
});

const bodySchema = z.object({
  conta: z.enum(CONTAS_EMISSORAS_VALIDAS),
});

const OVERLAP_DIAS = 3; // D3
const PRIMEIRA_JANELA_DIAS = 90;

/** Data UTC de hoje - N dias, no formato YYYY-MM-DD exigido pela Cora. */
function diasAtras(base: Date, dias: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(sincronizarLimiter, sessao.userId, 'sincronização de extrato');

  // Feature flag (achado 2026-08-05): a Cora cobra por chamada de extrato. A baixa de boletos
  // pagos não depende disso — já acontece de graça via webhook. Desligado por padrão.
  if (getServerEnv().EXTRATO_SYNC_HABILITADO !== 'true') {
    throw new ApiError(
      403,
      'Sincronização de extrato desabilitada (custo por chamada na Cora). A baixa de boletos ' +
        'pagos continua automática via webhook, sem custo.',
      'EXTRATO_SYNC_DESABILITADO',
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'Corpo inválido: informe a conta emissora.', 'VALIDATION', {
      issues: parsed.error.issues,
    });
  }
  const conta = parsed.data.conta;

  // Janela: do fim do último sync (menos overlap) até hoje; primeira vez, últimos 90 dias.
  const hoje = new Date();
  const anterior = await ultimoSync(conta);
  const inicio = anterior
    ? diasAtras(new Date(`${anterior.periodoFim}T00:00:00Z`), OVERLAP_DIAS)
    : diasAtras(hoje, PRIMEIRA_JANELA_DIAS);
  const fim = hoje.toISOString().slice(0, 10);

  // Conta sem credenciais não pode virar 500 mudo (padrão D-721/7.3).
  let gateway;
  try {
    gateway = criarContaGateway(conta);
  } catch (e) {
    throw new ApiError(
      503,
      e instanceof Error ? e.message : 'Conta emissora sem credenciais configuradas.',
      'CONTA_NAO_CONFIGURADA',
      { conta },
    );
  }

  const extrato = await gateway.consultarExtrato({ inicio, fim });
  if (!extrato.sucesso) {
    throw new ApiError(502, 'A consulta do extrato no banco falhou.', 'SYNC_FALHOU', {
      conta,
      periodo: { inicio, fim },
      erro: extrato.erro,
    });
  }

  // Upsert idempotente (AC 5): não duplica, não regride estados de conciliação.
  const resultadoUpsert = await upsertTransacoes(conta, extrato.transacoes);

  // Matching (D2): resolve créditos recalculáveis × boletos pagos livres da MESMA conta.
  const [creditos, boletosPagos] = await Promise.all([
    listarCreditosParaMatching(conta),
    listarBoletosPagosParaConciliacao(conta),
  ]);
  const transicoes = conciliar(
    creditos.map((t) => ({
      transacaoId: t.id,
      tipo: t.tipo,
      transactionType: t.transactionType,
      valor: t.valor,
      contraparteDocumento: t.contraparteDocumento,
      dataTransacao: t.dataTransacao,
      statusConciliacao: t.statusConciliacao,
    })),
    boletosPagos,
  );
  // Aplica só o que muda de estado (evita updates no-op em transações já resolvidas igual).
  const estadoAtual = new Map(creditos.map((t) => [t.id, t]));
  const mudancas = transicoes.filter((tr) => {
    const atual = estadoAtual.get(tr.transacaoId);
    return atual && (atual.statusConciliacao !== tr.status || atual.boletoId !== tr.boletoId);
  });
  const aplicacao = await aplicarTransicoesConciliacao(mudancas);

  // Log do sync (auditoria + janela do próximo).
  await registrarSync(conta, { inicio, fim }, resultadoUpsert, sessao.userId);

  // Categorização (D3, Story 9.2): roda sobre TODAS as transações da conta ainda
  // sem_categoria — não só o lote deste sync (resolve de brinde qualquer transação
  // antiga nunca categorizada). Nunca recategoriza o que já é sugerida/confirmada.
  const categoriasSistema = await buscarCategoriasSistema();
  const regrasAtivas = await listarRegras({ ativo: true });
  const pendentesCategorizacao = await listarTransacoes({
    contaEmissora: conta,
    statusCategorizacao: 'sem_categoria',
  });
  const resultadosCategorizacao = categorizar(
    pendentesCategorizacao.map((t) => ({
      transacaoId: t.id,
      tipo: t.tipo,
      transactionType: t.transactionType,
      contraparteNome: t.contraparteNome,
      descricao: t.descricao,
      conciliadaComBoleto: t.statusConciliacao.startsWith('conciliado'),
    })),
    regrasAtivas.map((r) => ({
      categoriaId: r.categoriaId,
      campo: r.campo,
      padrao: r.padrao,
      prioridade: r.prioridade,
    })),
    categoriasSistema,
  );
  for (const r of resultadosCategorizacao) {
    if (r.status === 'sem_categoria' || !r.categoriaId) continue;
    await categorizarTransacao(r.transacaoId, { categoriaId: r.categoriaId, status: r.status });
  }
  const resumoCategorizacao = {
    confirmadas: resultadosCategorizacao.filter((r) => r.status === 'confirmada').length,
    sugeridas: resultadosCategorizacao.filter((r) => r.status === 'sugerida').length,
    semCategoria: resultadosCategorizacao.filter((r) => r.status === 'sem_categoria').length,
  };

  return NextResponse.json({
    conta,
    periodo: { inicio, fim },
    transacoes: {
      novas: resultadoUpsert.qtdNovas,
      atualizadas: resultadoUpsert.qtdAtualizadas,
    },
    conciliacao: {
      ...resumirTransicoes(transicoes),
      transicoesAplicadas: aplicacao.aplicadas,
      transicoesDescartadas: aplicacao.descartadas,
    },
    categorizacao: resumoCategorizacao,
  });
});
