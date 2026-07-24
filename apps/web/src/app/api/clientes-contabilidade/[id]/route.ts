// GET /api/clientes-contabilidade/[id] — detalhe. PATCH — atualiza (admin), exige motivo, gera
// histórico. DELETE — exclui permanentemente (admin).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  buscarClienteContabilidade,
  atualizarClienteContabilidade,
  excluirClienteContabilidade,
} from '@/server/repositories/cliente-contabilidade-repository';
import { atualizarClienteContabilidadeSchema } from '@/server/validation/cliente-contabilidade-schema';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const cliente = await buscarClienteContabilidade(params.id);
  if (!cliente) throw new ApiError(404, 'Cliente contábil não encontrado', 'NOT_FOUND');
  return Response.json(cliente);
});

export const PATCH = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin']);
  const parsed = atualizarClienteContabilidadeSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const { motivo, ...dados } = parsed.data;
  const cliente = await atualizarClienteContabilidade(params.id, dados, sessao.userId, motivo);
  return Response.json(cliente);
});

export const DELETE = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin']);
  await excluirClienteContabilidade(params.id);
  return new Response(null, { status: 204 });
});
