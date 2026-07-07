// POST /api/medicos/excluir-lote — exclusão em massa (admin). Irreversível: médicos com
// execução/resultado financeiro vinculado são bloqueados individualmente (ver excluirMedico).
// Achado B-4: limitado a 50 IDs por request para evitar exclusões acidentais em massa.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { excluirMedicos } from '@/server/repositories/medico-repository';
import { excluirMedicosSchema } from '@/server/validation/medico-schema';

const MAX_EXCLUSAO_LOTE = 50;

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  const parsed = excluirMedicosSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  // Achado B-4: limite de tamanho para evitar exclusão acidental em massa.
  if (parsed.data.ids.length > MAX_EXCLUSAO_LOTE) {
    throw new ApiError(
      422,
      `Máximo de ${MAX_EXCLUSAO_LOTE} médicos por operação de exclusão em lote`,
      'LIMITE_LOTE',
    );
  }

  // Achado B-4: log estruturado da exclusão para auditoria.
  console.info(
    JSON.stringify({
      event: 'EXCLUSAO_LOTE',
      adminId: sessao.userId,
      qtd: parsed.data.ids.length,
      ids: parsed.data.ids,
      timestamp: new Date().toISOString(),
    }),
  );

  const resultado = await excluirMedicos(parsed.data.ids);
  return Response.json(resultado);
});
