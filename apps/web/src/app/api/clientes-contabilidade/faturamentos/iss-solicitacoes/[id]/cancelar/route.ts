// POST /api/clientes-contabilidade/faturamentos/iss-solicitacoes/[id]/cancelar — o operador
// desiste da busca no ISS (Story 13.5, AC 9). Só cancela `pendente`/`em_andamento`; qualquer
// outro status ⇒ 422 (nada a cancelar). Se o agente estiver no meio, o próximo progresso dele
// recebe 409 e ele para sozinho.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { cancelarSolicitacaoIss } from '@/server/repositories/iss-solicitacao-repository';
import { idSolicitacaoIssSchema } from '@/server/validation/iss-solicitacao-schema';

export const POST = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const id = idSolicitacaoIssSchema.safeParse(params.id);
  if (!id.success) throw new ApiError(404, 'Solicitação não encontrada', 'NOT_FOUND');
  return Response.json(await cancelarSolicitacaoIss(id.data));
});
