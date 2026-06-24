// GET /api/execucoes/[id]/resultados — relatório completo (PRD §8.4).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarResultados } from '@/server/repositories/execucao-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const resultados = await listarResultados(params.id);
  return Response.json(resultados);
});
