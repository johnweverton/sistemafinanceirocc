// GET /api/boletos/lotes/[id] — status e itens do lote (acompanhamento/polling da UI).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { buscarLote, listarItensLote } from '@/server/repositories/lote-emissao-repository';
import { listarResultados } from '@/server/repositories/execucao-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'financeiro']);

  const lote = await buscarLote(params.id);
  if (!lote) throw new ApiError(404, 'Lote de emissão não encontrado', 'LOTE_NAO_ENCONTRADO');

  const itens = await listarItensLote(lote.id);

  // Nome do pagador — mesmo join do preview (POST /api/boletos/lotes): sem ele o operador vê
  // "1 falha" sem saber QUEM falhou.
  const nomePorResultado =
    lote.escopoTipo === 'execucao'
      ? new Map((await listarResultados(lote.escopoRef)).map((r) => [r.id, r.nome]))
      : new Map<string, string>();
  const itensComNome = itens.map((item) => ({ ...item, nome: nomePorResultado.get(item.execucaoResultadoId) ?? '—' }));

  return Response.json({ lote, itens: itensComNome });
});
