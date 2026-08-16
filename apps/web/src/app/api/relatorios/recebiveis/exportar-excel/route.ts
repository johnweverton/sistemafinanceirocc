// GET /api/relatorios/recebiveis/exportar-excel — exporta o relatório de recebíveis agrupado
// por empresa em .xlsx (Módulo de Relatórios). Mesmo padrão de api/extrato/exportar-ofx/route.ts.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarRecebiveis } from '@/server/repositories/recebiveis-repository';
import { agruparRecebiveisPorEmpresa } from '@/server/engine/relatorio-recebiveis';
import { gerarRelatorioRecebiveisExcel } from '@/server/engine/relatorio-recebiveis-excel';
import { CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';

const querySchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Formato esperado: YYYY-MM').optional(),
  conta: z.enum(CONTAS_EMISSORAS_VALIDAS).optional(),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const query = querySchema.safeParse({
    competencia: url.searchParams.get('competencia') ?? undefined,
    conta: url.searchParams.get('conta') ?? undefined,
  });
  if (!query.success) {
    throw new ApiError(400, 'Parâmetros de consulta inválidos', 'VALIDATION', { issues: query.error.issues });
  }
  const { competencia, conta } = query.data;

  const recebiveis = await listarRecebiveis({ competencia, contaEmissora: conta });
  const relatorio = agruparRecebiveisPorEmpresa(recebiveis, { competencia, contaEmissora: conta });
  const buffer = await gerarRelatorioRecebiveisExcel(relatorio);

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="recebiveis-${competencia ?? 'todas'}-${conta ?? 'todas'}.xlsx"`,
    },
  });
});
