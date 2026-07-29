// POST /api/execucoes/[id]/retomar — retoma manualmente uma execução travada em "processando"
// (ex.: encadeamento entre lotes falhou). Autenticado por sessão (não pelo segredo interno),
// diferente de processar-lote/route.ts que é chamado só internamente.
//
// Retomar é sempre seguro: o cursor de processarProximoLote é `contarResultados` (derivado do
// banco), então reinvocar dispararPrimeiroLote continua de onde parou, sem duplicar nada.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import { dispararPrimeiroLote } from '@/server/orchestrator/execucao-orchestrator';
import { buscarExecucao } from '@/server/repositories/execucao-repository';

const retomarLimiter = createRateLimiter('execucoes-retomar', { limit: 5, windowMs: 60_000 });

export const POST = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  const sessao = await requireRole(['admin', 'colaborador']);
  assertRateLimit(retomarLimiter, sessao.userId, 'retomada de execução');

  const execucao = await buscarExecucao(params.id);
  if (!execucao) throw new ApiError(404, 'Execução não encontrada', 'NOT_FOUND');
  if (execucao.status !== 'processando') {
    throw new ApiError(422, 'Só é possível retomar uma execução em processamento', 'EXECUCAO_NAO_RETOMAVEL');
  }

  // Fire-and-forget, mesmo padrão do disparo inicial (POST /api/execucoes) — responde já.
  void dispararPrimeiroLote(execucao.id);

  return Response.json({ ok: true }, { status: 202 });
});
