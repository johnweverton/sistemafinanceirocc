// GET /api/config-cobranca — lê os defaults comerciais (autenticado).
// PUT /api/config-cobranca — atualiza (admin). Fase 3.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { lerConfig, atualizarConfig } from '@/server/repositories/config-cobranca-repository';
import { configCobrancaSchema } from '@/server/validation/medico-schema';

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const config = await lerConfig();
  return Response.json(config);
});

export const PUT = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = configCobrancaSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const config = await atualizarConfig(parsed.data);
  return Response.json(config);
});
