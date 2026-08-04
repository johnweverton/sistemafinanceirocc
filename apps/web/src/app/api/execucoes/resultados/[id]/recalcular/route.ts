// POST /api/execucoes/resultados/[id]/recalcular — reprocessa um resultado já gravado com os
// itens de produção ATUAIS da origem (migration 0041, achado real 2026-08-04, Dr. José Neias:
// dado corrigido no Sistema Web depois que a execução já tinha rodado, sem forma de refletir a
// correção sem uma execução nova inteira). Mesma trava de permissão de quem revisa/emite boleto.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { recalcularResultado } from '@/server/orchestrator/recalculo-resultado';

export const POST = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  const resultado = await recalcularResultado(params.id, sessao.userId);
  return Response.json({ resultado });
});
