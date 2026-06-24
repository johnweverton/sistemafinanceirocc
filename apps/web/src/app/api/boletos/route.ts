// GET /api/boletos?execucaoId=... — lista boletos de uma execução (para UI de relatório).
import { NextResponse, type NextRequest } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarBoletosPorExecucao } from '@/server/repositories/boleto-repository';

export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireRole(['admin', 'financeiro']);

  const execucaoId = req.nextUrl.searchParams.get('execucaoId');
  if (!execucaoId) {
    throw new ApiError(400, 'Query param execucaoId é obrigatório', 'PARAM_MISSING');
  }

  const boletos = await listarBoletosPorExecucao(execucaoId);
  return NextResponse.json({ boletos });
});
