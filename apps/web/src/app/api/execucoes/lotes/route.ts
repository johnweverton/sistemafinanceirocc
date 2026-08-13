// GET /api/execucoes/lotes?producaoId=<id da produção mensal> — sub-lotes (Cateter/Fístula/
// Angiografia/Carta de Rede) dentro da produção mensal de um médico Angiologista. Endpoint
// aditivo da origem (devolutiva do desenvolvedor, GATE 2026-08-13): fin-producoes NÃO devolve
// esses sub-lotes — só `fin-lotes?producaoId=` os enxerga. Chamado sob demanda pela UI (nunca
// pré-carregado em /execucoes/apoio, que buscaria lotes de TODA produção de TODO médico à toa).
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarLotes } from '@/server/integration/fin-api-client';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  producaoId: z.string().min(1, 'producaoId é obrigatório'),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const url = new URL(req.url);
  const query = querySchema.safeParse({ producaoId: url.searchParams.get('producaoId') ?? undefined });
  if (!query.success) {
    throw new ApiError(400, 'Parâmetro producaoId é obrigatório', 'VALIDATION', {
      issues: query.error.issues,
    });
  }
  const lotes = await listarLotes(query.data.producaoId);
  return Response.json({ lotes });
});
