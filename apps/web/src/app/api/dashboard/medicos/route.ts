// GET /api/dashboard/medicos — resumo por médico (admin/financeiro).
import type { ContaEmissora } from '@cobranca/shared';
import { CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { resumoPorMedico } from '@/server/repositories/dashboard-repository';

/** Valor fora da whitelist vira "ausente" — não é motivo de erro (filtro só, sem validação estrita). */
function parseContaEmissora(v: string | null): ContaEmissora | undefined {
  return v && (CONTAS_EMISSORAS_VALIDAS as readonly string[]).includes(v) ? (v as ContaEmissora) : undefined;
}

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const searchParams = new URL(req.url).searchParams;
  const competencia = searchParams.get('competencia') ?? undefined;
  const contaEmissora = parseContaEmissora(searchParams.get('contaEmissora'));
  return Response.json(await resumoPorMedico(competencia, contaEmissora));
});
