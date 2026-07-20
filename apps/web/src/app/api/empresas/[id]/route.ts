// GET /api/empresas/[id] — detalhe. PATCH — atualiza (admin), exige motivo, gera histórico.
// DELETE — exclui permanentemente (admin); bloqueado se houver médicos vinculados.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { buscarEmpresa, atualizarEmpresa, excluirEmpresa } from '@/server/repositories/empresa-repository';
import { atualizarEmpresaSchema } from '@/server/validation/empresa-schema';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const empresa = await buscarEmpresa(params.id);
  if (!empresa) throw new ApiError(404, 'Empresa não encontrada', 'NOT_FOUND');
  return Response.json(empresa);
});

export const PATCH = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin']);
  const parsed = atualizarEmpresaSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const { motivo, ...dados } = parsed.data;
  const empresa = await atualizarEmpresa(params.id, dados, sessao.userId, motivo);
  return Response.json(empresa);
});

export const DELETE = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin']);
  await excluirEmpresa(params.id);
  return new Response(null, { status: 204 });
});
