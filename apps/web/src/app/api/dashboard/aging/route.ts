// GET /api/dashboard/aging — aging de vencidos (admin/financeiro).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { aging } from '@/server/repositories/dashboard-repository';

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const competencia = new URL(req.url).searchParams.get('competencia') ?? undefined;
  return Response.json(await aging(competencia));
});
