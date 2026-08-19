// GET /api/dashboard/tipo-servico — resumo Cobrança Médica vs Contabilidade (admin/financeiro,
// migration 0050, feedback do dono 2026-08-19).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { resumoPorTipoServico } from '@/server/repositories/dashboard-repository';

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const competencia = new URL(req.url).searchParams.get('competencia') ?? undefined;
  return Response.json(await resumoPorTipoServico(competencia));
});
