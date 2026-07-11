// PATCH/DELETE /api/plano-contas/regras/[id] — admin (Story 9.2, AC 4).
// `ativo: false` no corpo do PATCH desativa em vez de atualizar campo/padrao/prioridade.
// DELETE é físico direto — regra é cadastro-folha, sem guard de vínculos (excluirRegra).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  atualizarRegra,
  desativarRegra,
  excluirRegra,
} from '@/server/repositories/plano-contas-repository';
import { CAMPOS_REGRA_CATEGORIZACAO_VALIDOS } from '@cobranca/shared';

const patchSchema = z.object({
  campo: z.enum(CAMPOS_REGRA_CATEGORIZACAO_VALIDOS).optional(),
  padrao: z.string().min(1).optional(),
  prioridade: z.number().int().optional(),
  ativo: z.literal(false).optional(),
});

export const PATCH = withErrorHandler<{ id: string }>(async (req, { params }) => {
  await requireRole(['admin']);
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  if (parsed.data.ativo === false) {
    const regra = await desativarRegra(params.id);
    return NextResponse.json(regra);
  }
  const regra = await atualizarRegra(params.id, {
    campo: parsed.data.campo,
    padrao: parsed.data.padrao,
    prioridade: parsed.data.prioridade,
  });
  return NextResponse.json(regra);
});

export const DELETE = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin']);
  await excluirRegra(params.id);
  return new NextResponse(null, { status: 204 });
});
