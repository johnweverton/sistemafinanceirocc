// GET /api/clientes-contabilidade — lista (filtrável). POST — cria (admin).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  listarClientesContabilidade,
  criarClienteContabilidade,
} from '@/server/repositories/cliente-contabilidade-repository';
import { novoClienteContabilidadeSchema } from '@/server/validation/cliente-contabilidade-schema';

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const url = new URL(req.url);
  const ativoParam = url.searchParams.get('ativo');
  const clientes = await listarClientesContabilidade({
    ativo: ativoParam == null ? undefined : ativoParam === 'true',
  });
  return Response.json(clientes);
});

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = novoClienteContabilidadeSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const cliente = await criarClienteContabilidade(parsed.data);
  return Response.json(cliente, { status: 201 });
});
