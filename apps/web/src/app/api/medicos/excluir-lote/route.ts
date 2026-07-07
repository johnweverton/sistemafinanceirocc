// POST /api/medicos/excluir-lote — exclusão em massa (admin). Irreversível: médicos com
// execução/resultado financeiro vinculado são bloqueados individualmente (ver excluirMedico).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { excluirMedicos } from '@/server/repositories/medico-repository';
import { excluirMedicosSchema } from '@/server/validation/medico-schema';

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = excluirMedicosSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  const resultado = await excluirMedicos(parsed.data.ids);
  return Response.json(resultado);
});
