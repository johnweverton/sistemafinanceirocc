// GET /api/config-relatorio-mensal — lê destinatários e dia de envio do relatório mensal
// automático (autenticado). PUT /api/config-relatorio-mensal — atualiza (admin).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { lerConfig, atualizarConfig } from '@/server/repositories/config-relatorio-mensal-repository';
import { configRelatorioMensalSchema } from '@/server/validation/config-relatorio-mensal-schema';

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const config = await lerConfig();
  return Response.json(config);
});

export const PUT = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = configRelatorioMensalSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const config = await atualizarConfig(parsed.data);
  return Response.json(config);
});
