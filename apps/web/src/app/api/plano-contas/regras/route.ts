// GET/POST /api/plano-contas/regras — regras de categorização por palavra-chave
// (Story 9.2, AC 4). Mesmo padrão de RBAC de /api/plano-contas (item 3): leitura
// admin/financeiro, escrita admin.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarRegra, listarRegras } from '@/server/repositories/plano-contas-repository';
import { CAMPOS_REGRA_CATEGORIZACAO_VALIDOS } from '@cobranca/shared';

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const ativoParam = url.searchParams.get('ativo');
  const ativo = ativoParam === null ? undefined : ativoParam === 'true';
  const regras = await listarRegras({ ativo });
  return NextResponse.json(regras);
});

const criarSchema = z.object({
  categoriaId: z.string().uuid('categoriaId deve ser UUID'),
  campo: z.enum(CAMPOS_REGRA_CATEGORIZACAO_VALIDOS),
  padrao: z.string().min(1, 'Informe o padrão da regra.'),
  prioridade: z.number().int().optional(),
});

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const regra = await criarRegra(parsed.data);
  return NextResponse.json(regra, { status: 201 });
});
