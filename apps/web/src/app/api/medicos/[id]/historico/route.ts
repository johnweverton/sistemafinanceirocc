// GET /api/medicos/[id]/historico — lista de eventos de alteração do médico.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { historicoDoMedico } from '@/server/repositories/medico-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const historico = await historicoDoMedico(params.id);
  return Response.json(historico);
});
