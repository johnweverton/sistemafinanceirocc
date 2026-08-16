// POST /api/relatorios/links/[id]/revogar — revoga um link público do BI de Relatórios.
import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { revogarLink } from '@/server/repositories/relatorio-links-repository';

export const POST = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'financeiro']);
  await revogarLink(params.id);
  return new NextResponse(null, { status: 204 });
});
