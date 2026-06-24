// GET /api/medicos — lista (filtrável). POST /api/medicos — cria (admin).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarMedicos, criarMedico } from '@/server/repositories/medico-repository';
import { novoMedicoSchema } from '@/server/validation/medico-schema';

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const url = new URL(req.url);
  const ativoParam = url.searchParams.get('ativo');
  const medicos = await listarMedicos({
    colaboradorResponsavel: url.searchParams.get('colaborador') ?? undefined,
    ativo: ativoParam == null ? undefined : ativoParam === 'true',
  });
  return Response.json(medicos);
});

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = novoMedicoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const medico = await criarMedico(parsed.data);
  return Response.json(medico, { status: 201 });
});
