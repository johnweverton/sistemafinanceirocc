// GET /api/config-lembrete-vencimento — lê o toggle do lembrete automático de vencimento D-1
// (autenticado). PUT /api/config-lembrete-vencimento — atualiza (admin).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { lerConfig, atualizarConfig } from '@/server/repositories/config-lembrete-vencimento-repository';
import { configLembreteVencimentoSchema } from '@/server/validation/config-lembrete-vencimento-schema';

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const config = await lerConfig();
  return Response.json(config);
});

export const PUT = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = configLembreteVencimentoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const config = await atualizarConfig(parsed.data);
  return Response.json(config);
});
