// GET /api/boletos?execucaoId=... — lista boletos de uma execução (para UI de relatório).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarBoletosPorExecucao } from '@/server/repositories/boleto-repository';

// Achado B-3: validar query param como UUID.
const boletosQuerySchema = z.object({
  execucaoId: z.string().uuid('execucaoId deve ser um UUID'),
});

export const GET = withErrorHandler(async (req: Request) => {
  await requireRole(['admin', 'financeiro']);

  const url = new URL(req.url);
  const query = boletosQuerySchema.safeParse({
    execucaoId: url.searchParams.get('execucaoId') ?? undefined,
  });
  if (!query.success) {
    throw new ApiError(400, 'Query param execucaoId é obrigatório e deve ser UUID', 'VALIDATION', {
      issues: query.error.issues,
    });
  }

  const boletos = await listarBoletosPorExecucao(query.data.execucaoId);
  return NextResponse.json({ boletos });
});
