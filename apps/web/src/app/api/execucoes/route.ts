// GET /api/execucoes — histórico (PRD §8.5). POST — dispara, responde 202 imediato (PRD §6.3).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarExecucoes } from '@/server/repositories/execucao-repository';
import { iniciarExecucao, dispararPrimeiroLote } from '@/server/orchestrator/execucao-orchestrator';
import { dispararExecucaoSchema } from '@/server/validation/execucao-schema';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';

// Achado I-1: rate limit — máximo 3 disparos de execução por minuto por usuário.
const execucaoLimiter = createRateLimiter('execucoes-disparar', { limit: 3, windowMs: 60_000 });

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const execucoes = await listarExecucoes();
  return Response.json(execucoes);
});

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'colaborador']);
  // Achado I-1: Protege contra disparo acidental múltiplo.
  assertRateLimit(execucaoLimiter, sessao.userId, 'disparo de execução');

  const parsed = dispararExecucaoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Payload inválido', 'VALIDATION', { issues: parsed.error.issues });
  }

  const execucao = await iniciarExecucao(
    parsed.data.competencia,
    parsed.data.selecoes,
    sessao.userId,
    undefined,
    parsed.data.empresaId,
    parsed.data.clienteContabilidadeId,
    parsed.data.ehAdicional,
  );

  // Fire-and-forget: dispara o primeiro lote sem aguardar (responde 202 já).
  void dispararPrimeiroLote(execucao.id);

  return Response.json({ execucaoId: execucao.id }, { status: 202 });
});
