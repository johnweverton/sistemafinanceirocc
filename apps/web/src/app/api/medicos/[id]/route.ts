// GET /api/medicos/[id] — detalhe. PATCH — atualiza (admin), exige motivo, gera histórico.
// DELETE — exclui permanentemente (admin); bloqueado se houver execuções vinculadas.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { buscarMedico, atualizarMedico, excluirMedico } from '@/server/repositories/medico-repository';
import { atualizarMedicoSchema } from '@/server/validation/medico-schema';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const medico = await buscarMedico(params.id);
  if (!medico) throw new ApiError(404, 'Médico não encontrado', 'NOT_FOUND');
  return Response.json(medico);
});

export const PATCH = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin']);
  const parsed = atualizarMedicoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const { motivo, ...dados } = parsed.data;
  const medico = await atualizarMedico(params.id, dados, sessao.userId, motivo);
  return Response.json(medico);
});

export const DELETE = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin']);
  await excluirMedico(params.id);
  return new Response(null, { status: 204 });
});
