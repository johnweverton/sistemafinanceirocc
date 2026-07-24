// GET /api/clientes-contabilidade/[id]/faturamentos — histórico de faturamento lançado.
// POST — lança/atualiza o faturamento da competência e devolve o valor do boleto calculado
// (preview) usando a regra de preço cadastrada do cliente (Story 11.2). Lançamento mensal é
// operação de rotina, não alteração de cadastro — não exige perfil admin (diferente do PATCH de
// cadastro em [id]/route.ts).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  lancarFaturamento,
  listarFaturamentos,
} from '@/server/repositories/cliente-contabilidade-faturamento-repository';
import { buscarClienteContabilidade } from '@/server/repositories/cliente-contabilidade-repository';
import { lancarFaturamentoSchema } from '@/server/validation/cliente-contabilidade-schema';
import { aplicarRegraPreco } from '@/server/engine/regra-preco';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const faturamentos = await listarFaturamentos(params.id);
  return Response.json(faturamentos);
});

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin', 'colaborador', 'financeiro']);
  const parsed = lancarFaturamentoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  const cliente = await buscarClienteContabilidade(params.id);
  if (!cliente) throw new ApiError(404, 'Cliente contábil não encontrado', 'NOT_FOUND');

  const { competencia, faturamento } = parsed.data;
  const registro = await lancarFaturamento(params.id, competencia, faturamento, sessao.userId);

  // Preview do valor calculado — reaproveita o mesmo Engine que a execução (Story 11.3) vai usar,
  // evitando duplicar a regra na UI. Alerta (não erro) se a regra do cliente estiver incompleta
  // ou não for do modo faixa_faturamento — o cadastro pode estar temporariamente inconsistente.
  const preview = aplicarRegraPreco(cliente.regraPreco, faturamento);

  return Response.json({ faturamento: registro, preview }, { status: 201 });
});
