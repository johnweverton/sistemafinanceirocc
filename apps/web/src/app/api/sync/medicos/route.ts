import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { sincronizar } from '@/server/medico-sync';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';

// Achado I-1: rate limit — máximo 5 sincronizações por minuto por usuário.
const syncLimiter = createRateLimiter('medicos-sync', { limit: 5, windowMs: 60_000 });

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  assertRateLimit(syncLimiter, sessao.userId, 'sincronização de médicos');
  
  const relatorio = await sincronizar(sessao.userId);
  return Response.json(relatorio);
});
