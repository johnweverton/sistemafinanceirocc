// GET /api/execucoes/[id] — status e progresso (polling de fallback; Realtime é o primário).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { buscarExecucao } from '@/server/repositories/execucao-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const execucao = await buscarExecucao(params.id);
  if (!execucao) throw new ApiError(404, 'Execução não encontrada', 'NOT_FOUND');
  return Response.json(execucao);
});
