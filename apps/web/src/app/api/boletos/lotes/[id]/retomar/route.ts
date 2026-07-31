// POST /api/boletos/lotes/[id]/retomar — retoma um lote pausado pelo circuit breaker
// (falhas consecutivas, taxa de falha, ou falha sistêmica — ver emissao-lote-orchestrator.ts).
// Só ADMIN: retomar depois de um breaker é decisão de risco (mesmo raciocínio da confirmação).
// Autenticado por sessão (não pelo segredo interno) — mesmo padrão de execucoes/[id]/retomar.
//
// Retomar é sempre seguro: o cursor de processarProximoLoteEmissao é a fila de itens
// 'pendente' (derivada do banco), então reinvocar continua de onde parou, sem duplicar nada.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import { retomarLote } from '@/server/repositories/lote-emissao-repository';
import { dispararProcessamentoLoteEmissao } from '@/server/orchestrator/emissao-lote-orchestrator';

const retomarLimiter = createRateLimiter('boletos-lote-retomar', { limit: 5, windowMs: 60_000 });

export const POST = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  const sessao = await requireRole(['admin']);
  assertRateLimit(retomarLimiter, sessao.userId, 'retomada de lote de emissão');

  const lote = await retomarLote(params.id);
  if (!lote) {
    throw new ApiError(
      422,
      'Só é possível retomar um lote pausado por falhas.',
      'LOTE_NAO_RETOMAVEL',
    );
  }

  void dispararProcessamentoLoteEmissao(lote.id);

  return Response.json({ lote }, { status: 202 });
});
