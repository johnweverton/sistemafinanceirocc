// GET /api/execucoes/resultados/[id]/contribuicoes — auditoria "qual médico contribuiu
// quanto" de um resultado AGREGADO por empresa (Story 10.4c). Vazio para resultado normal.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarContribuicoes } from '@/server/repositories/execucao-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const contribuicoes = await listarContribuicoes(params.id);
  return Response.json(contribuicoes);
});
