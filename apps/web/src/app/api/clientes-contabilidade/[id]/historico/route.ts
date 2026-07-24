// GET /api/clientes-contabilidade/[id]/historico — lista de eventos de alteração do cliente.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { historicoDoClienteContabilidade } from '@/server/repositories/cliente-contabilidade-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const historico = await historicoDoClienteContabilidade(params.id);
  return Response.json(historico);
});
