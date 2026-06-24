// GET /api/execucoes — histórico (PRD §8.5). POST — dispara, responde 202 imediato (PRD §6.3).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarExecucoes } from '@/server/repositories/execucao-repository';
import { iniciarExecucao, dispararPrimeiroLote } from '@/server/orchestrator/execucao-orchestrator';
import { dispararExecucaoSchema } from '@/server/validation/execucao-schema';

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const execucoes = await listarExecucoes();
  return Response.json(execucoes);
});

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'colaborador']);
  const parsed = dispararExecucaoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Competência inválida', 'VALIDATION', { issues: parsed.error.issues });
  }

  const execucao = await iniciarExecucao(parsed.data.competencia, sessao.userId);

  // Fire-and-forget: dispara o primeiro lote sem aguardar (responde 202 já).
  void dispararPrimeiroLote(execucao.id);

  return Response.json({ execucaoId: execucao.id }, { status: 202 });
});
