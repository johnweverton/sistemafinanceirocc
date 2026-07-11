// GET /api/dre/relatorio — relatório do DRE por período (Story 9.2, AC 7).
// admin/financeiro. `conta` ausente = consolidado MC+CV (drill-down por empresa quando
// informado). Datas sempre YYYY-MM-DD (mesmo padrão do GET /api/extrato).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { gerarRelatorioDre } from '@/server/repositories/dre-repository';
import { CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';

const querySchema = z.object({
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  conta: z.enum(CONTAS_EMISSORAS_VALIDAS).optional(),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const query = querySchema.safeParse({
    inicio: url.searchParams.get('inicio') ?? undefined,
    fim: url.searchParams.get('fim') ?? undefined,
    conta: url.searchParams.get('conta') ?? undefined,
  });
  if (!query.success) {
    throw new ApiError(
      400,
      'Parâmetros de consulta inválidos: informe inicio e fim (YYYY-MM-DD).',
      'VALIDATION',
      { issues: query.error.issues },
    );
  }

  const relatorio = await gerarRelatorioDre(
    { inicio: query.data.inicio, fim: query.data.fim },
    query.data.conta,
  );
  return NextResponse.json(relatorio);
});
