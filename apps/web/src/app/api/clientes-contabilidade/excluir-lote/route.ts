// POST /api/clientes-contabilidade/excluir-lote — exclusão em massa (admin). Limitado a 50 IDs
// por request para evitar exclusões acidentais em massa (mesmo padrão de medicos/excluir-lote).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { excluirClientesContabilidade } from '@/server/repositories/cliente-contabilidade-repository';
import { excluirClientesContabilidadeSchema } from '@/server/validation/cliente-contabilidade-schema';

const MAX_EXCLUSAO_LOTE = 50;

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin']);
  const parsed = excluirClientesContabilidadeSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  if (parsed.data.ids.length > MAX_EXCLUSAO_LOTE) {
    throw new ApiError(
      422,
      `Máximo de ${MAX_EXCLUSAO_LOTE} clientes por operação de exclusão em lote`,
      'LIMITE_LOTE',
    );
  }

  console.info(
    JSON.stringify({
      event: 'EXCLUSAO_LOTE_CLIENTE_CONTABILIDADE',
      adminId: sessao.userId,
      qtd: parsed.data.ids.length,
      ids: parsed.data.ids,
      timestamp: new Date().toISOString(),
    }),
  );

  const resultado = await excluirClientesContabilidade(parsed.data.ids);
  return Response.json(resultado);
});
