// GET /api/clientes-contabilidade/[id]/execucoes — histórico de execuções/boletos do cliente
// (Story 11.5), competência mais recente primeiro.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { historicoResultadosPorClienteContabilidade } from '@/server/repositories/execucao-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const historico = await historicoResultadosPorClienteContabilidade(params.id);
  return Response.json(historico);
});
