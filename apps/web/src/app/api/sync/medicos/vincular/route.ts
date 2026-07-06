import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { vincularExternalId } from '@/server/repositories/medico-repository';
import { vincularMedicoSchema } from '@/server/validation/medico-schema';

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  const parsed = vincularMedicoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  const { medicoId, externalId } = parsed.data;
  const medico = await vincularExternalId(
    medicoId,
    externalId,
    sessao.userId,
    'Vinculado via painel de sincronização',
  );

  return Response.json(medico);
});
