// GET/POST /api/dre/lancamentos — lançamentos manuais de despesa fora da Cora
// (Story 9.2, AC 6). admin/financeiro (mesmo padrão de /extrato). O corpo do POST é
// validado com Zod discriminado por tipoLancamento, espelhando o CHECK cruzado da
// migration 0023 — dupla validação (Zod na borda + repository).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  criarLancamento,
  listarLancamentos,
  type CriarLancamentoInput,
} from '@/server/repositories/dre-repository';
import {
  CONTAS_EMISSORAS_VALIDAS,
  TIPOS_LANCAMENTO_MANUAL_VALIDOS,
} from '@cobranca/shared';

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  conta: z.enum(CONTAS_EMISSORAS_VALIDAS).optional(),
  tipo: z.enum(TIPOS_LANCAMENTO_MANUAL_VALIDOS).optional(),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const query = querySchema.safeParse({
    conta: url.searchParams.get('conta') ?? undefined,
    tipo: url.searchParams.get('tipo') ?? undefined,
  });
  if (!query.success) {
    throw new ApiError(400, 'Parâmetros de consulta inválidos', 'VALIDATION', {
      issues: query.error.issues,
    });
  }
  const lancamentos = await listarLancamentos({
    contaEmissora: query.data.conta,
    tipoLancamento: query.data.tipo,
  });
  return NextResponse.json(lancamentos);
});

const camposComuns = {
  contaEmissora: z.enum(CONTAS_EMISSORAS_VALIDAS),
  categoriaId: z.string().uuid('categoriaId deve ser UUID'),
  descricao: z.string().min(1, 'Informe a descrição.'),
  valor: z.number().positive('Valor deve ser positivo.'),
};

const criarSchema = z.discriminatedUnion('tipoLancamento', [
  z.object({
    tipoLancamento: z.literal('avulso'),
    ...camposComuns,
    data: z.string().regex(DATA_REGEX, 'Formato esperado: YYYY-MM-DD'),
  }),
  z.object({
    tipoLancamento: z.literal('recorrente'),
    ...camposComuns,
    diaDoMes: z.number().int().min(1).max(28),
    dataInicio: z.string().regex(DATA_REGEX, 'Formato esperado: YYYY-MM-DD'),
    dataFim: z.string().regex(DATA_REGEX, 'Formato esperado: YYYY-MM-DD').nullable().optional(),
  }),
]);

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  const parsed = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const input = { ...parsed.data, criadoPor: sessao.userId } as CriarLancamentoInput;
  const lancamento = await criarLancamento(input);
  return NextResponse.json(lancamento, { status: 201 });
});
