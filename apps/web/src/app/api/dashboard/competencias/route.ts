// GET /api/dashboard/competencias — resumo por competência (admin/financeiro).
import type { ContaEmissora, TipoServico } from '@cobranca/shared';
import { CONTAS_EMISSORAS_VALIDAS, TIPOS_SERVICO_VALIDOS } from '@cobranca/shared';
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { resumoPorCompetencia } from '@/server/repositories/dashboard-repository';

/** Valor fora da whitelist vira "ausente" — não é motivo de erro (filtro só, sem validação estrita). */
function parseContaEmissora(v: string | null): ContaEmissora | undefined {
  return v && (CONTAS_EMISSORAS_VALIDAS as readonly string[]).includes(v) ? (v as ContaEmissora) : undefined;
}

function parseTipoServico(v: string | null): TipoServico | undefined {
  return v && (TIPOS_SERVICO_VALIDOS as readonly string[]).includes(v) ? (v as TipoServico) : undefined;
}

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const searchParams = new URL(req.url).searchParams;
  const competencia = searchParams.get('competencia') ?? undefined;
  const contaEmissora = parseContaEmissora(searchParams.get('contaEmissora'));
  const tipoServico = parseTipoServico(searchParams.get('tipoServico'));
  return Response.json(await resumoPorCompetencia(competencia, contaEmissora, tipoServico));
});
