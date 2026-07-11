// PATCH/DELETE /api/plano-contas/[id] — admin (Story 9.2, AC 3).
// PATCH: nome/ordem (nunca grupo/sistema — nem no schema, reforçando o repository).
// `ativo: false` no corpo desativa (soft-disable) em vez de renomear — categoria de
// sistema rejeita (400 CATEGORIA_SISTEMA_PROTEGIDA, do repository).
// DELETE: exclusão física — o repository já resolve os 3 casos de erro com o status
// certo (400 CATEGORIA_SISTEMA_PROTEGIDA/CATEGORIA_INATIVA, 409 CATEGORIA_EM_USO).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  atualizarCategoria,
  desativarCategoria,
  excluirCategoria,
} from '@/server/repositories/plano-contas-repository';

const patchSchema = z
  .object({
    nome: z.string().min(1).optional(),
    ordem: z.number().int().optional(),
    ativo: z.literal(false).optional(),
  })
  .refine((d) => d.nome !== undefined || d.ordem !== undefined || d.ativo !== undefined, {
    message: 'Informe ao menos um campo para atualizar (nome, ordem ou ativo).',
  });

export const PATCH = withErrorHandler<{ id: string }>(async (req, { params }) => {
  await requireRole(['admin']);
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }

  if (parsed.data.ativo === false) {
    const categoria = await desativarCategoria(params.id);
    return NextResponse.json(categoria);
  }
  const categoria = await atualizarCategoria(params.id, {
    nome: parsed.data.nome,
    ordem: parsed.data.ordem,
  });
  return NextResponse.json(categoria);
});

export const DELETE = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin']);
  await excluirCategoria(params.id);
  return new NextResponse(null, { status: 204 });
});
