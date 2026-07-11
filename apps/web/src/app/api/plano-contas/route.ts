// GET/POST /api/plano-contas — cadastro do plano de contas do DRE (Story 9.2, AC 3).
// Leitura admin/financeiro (mesmo padrão de /extrato); escrita admin (mesmo padrão de
// config-cobranca — muda a fórmula do relatório).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarCategoria, listarCategorias } from '@/server/repositories/plano-contas-repository';
import { GRUPOS_PLANO_CONTAS_VALIDOS } from '@cobranca/shared';

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const ativoParam = url.searchParams.get('ativo');
  const ativo = ativoParam === null ? undefined : ativoParam === 'true';
  const categorias = await listarCategorias({ ativo });
  return NextResponse.json(categorias);
});

const criarSchema = z.object({
  grupo: z.enum(GRUPOS_PLANO_CONTAS_VALIDOS),
  nome: z.string().min(1, 'Informe o nome da categoria.'),
  ordem: z.number().int().optional(),
});

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const categoria = await criarCategoria(parsed.data);
  return NextResponse.json(categoria, { status: 201 });
});
