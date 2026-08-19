// POST /api/clientes-contabilidade/faturamentos/lote — lançamento de faturamento EM MASSA
// (feedback do dono, 2026-08-20): mesma competência pra vários clientes `faixa_faturamento` de
// uma vez, passo que precede o cálculo em lote (POST /api/clientes-contabilidade/lote). Mesmo
// papel/sem exigir admin do lançamento individual (é operação de rotina, não alteração de
// cadastro — ver [id]/faturamentos/route.ts).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { lancarFaturamentoLote } from '@/server/repositories/cliente-contabilidade-faturamento-repository';
import { lancarFaturamentoLoteSchema } from '@/server/validation/cliente-contabilidade-schema';

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'colaborador', 'financeiro']);
  const parsed = lancarFaturamentoLoteSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  const resultado = await lancarFaturamentoLote(
    parsed.data.competencia,
    parsed.data.lancamentos,
    sessao.userId,
  );

  return Response.json(resultado, { status: 201 });
});
