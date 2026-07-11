// DELETE /api/dre/lancamentos/[id] — exclui um lançamento manual (Story 9.2, AC 6).
// admin/financeiro (mesmo padrão de /extrato). Exclusão física direta — lançamento
// manual não tem estado histórico dependente (ao contrário de plano_contas).
import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { excluirLancamento } from '@/server/repositories/dre-repository';

export const DELETE = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'financeiro']);
  await excluirLancamento(params.id);
  return new NextResponse(null, { status: 204 });
});
