// GET /api/boletos/lotes/[id] — status e itens do lote (acompanhamento/polling da UI).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { buscarLote, listarItensLote } from '@/server/repositories/lote-emissao-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'financeiro']);

  const lote = await buscarLote(params.id);
  if (!lote) throw new ApiError(404, 'Lote de emissão não encontrado', 'LOTE_NAO_ENCONTRADO');

  const itens = await listarItensLote(lote.id);
  return Response.json({ lote, itens });
});
