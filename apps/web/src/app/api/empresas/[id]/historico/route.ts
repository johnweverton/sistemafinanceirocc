// GET /api/empresas/[id]/historico — lista de eventos de alteração da empresa.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { historicoDaEmpresa } from '@/server/repositories/empresa-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const historico = await historicoDaEmpresa(params.id);
  return Response.json(historico);
});
