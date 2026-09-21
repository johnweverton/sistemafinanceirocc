// POST /api/boletos/lotes/[id]/itens/[itemId]/reprocessar — reprocessa UM item que falhou,
// sem esperar por ele (ou por qualquer outro item) travar o lote inteiro. Diferente de
// .../retomar (que só existe para lotes pausados pelo circuit breaker), este endpoint cobre o
// caso comum: o lote CONTINUA e conclui com 1 de N itens em falha de dado/gateway pontual — o
// operador corrige o cadastro (ou a causa) e reenvia só aquele item, sem reprocessar os outros
// que já emitiram.
// Só ADMIN: mesmo raciocínio de /confirmar e /retomar — reenviar uma escrita financeira é
// decisão de risco, não uma leitura.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import { buscarLote, resetarItemParaPendente, reabrirLoteParaProcessamento } from '@/server/repositories/lote-emissao-repository';
import { dispararProcessamentoLoteEmissao } from '@/server/orchestrator/emissao-lote-orchestrator';

const reprocessarLimiter = createRateLimiter('boletos-lote-item-reprocessar', { limit: 20, windowMs: 60_000 });

export const POST = withErrorHandler<{ id: string; itemId: string }>(async (_req, { params }) => {
  const sessao = await requireRole(['admin']);
  assertRateLimit(reprocessarLimiter, sessao.userId, 'reprocessamento de item de lote de emissão');

  const lote = await buscarLote(params.id);
  if (!lote) throw new ApiError(404, 'Lote de emissão não encontrado', 'LOTE_NAO_ENCONTRADO');

  const item = await resetarItemParaPendente(params.id, params.itemId);
  if (!item) {
    throw new ApiError(422, 'Só é possível reprocessar um item que está com falha.', 'ITEM_NAO_REPROCESSAVEL');
  }

  // Se o lote já tinha concluído (ou está pausado), reabre — do contrário
  // `processarProximoLoteEmissao` ignora a invocação (só age em lote 'processando').
  if (lote.status !== 'processando') {
    await reabrirLoteParaProcessamento(lote.id);
  }

  void dispararProcessamentoLoteEmissao(lote.id);

  return Response.json({ item }, { status: 202 });
});
