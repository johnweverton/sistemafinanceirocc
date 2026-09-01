// GET /api/dashboard/lembretes-vencimento — contagem de lembretes de vencimento enviados no mês
// corrente (Épico 13, indicador de auditoria para a CEO).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { contarLembretesVencimentoNoMes } from '@/server/repositories/dashboard-repository';

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'financeiro']);
  const enviadosNoMes = await contarLembretesVencimentoNoMes();
  return Response.json({ enviadosNoMes });
});
