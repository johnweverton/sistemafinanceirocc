// GET /api/empresas — lista (filtrável). POST /api/empresas — cria (admin).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarEmpresas, criarEmpresa } from '@/server/repositories/empresa-repository';
import { novaEmpresaSchema } from '@/server/validation/empresa-schema';

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const url = new URL(req.url);
  const ativoParam = url.searchParams.get('ativo');
  const empresas = await listarEmpresas({
    ativo: ativoParam == null ? undefined : ativoParam === 'true',
  });
  return Response.json(empresas);
});

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = novaEmpresaSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const empresa = await criarEmpresa(parsed.data);
  return Response.json(empresa, { status: 201 });
});
