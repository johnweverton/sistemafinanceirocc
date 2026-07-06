import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { sincronizar } from '@/server/medico-sync';

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  const relatorio = await sincronizar(sessao.userId);
  return Response.json(relatorio);
});
