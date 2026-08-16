// GET/POST /api/relatorios/links — gestão dos links públicos do BI de Relatórios.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarLink, listarLinks } from '@/server/repositories/relatorio-links-repository';
import { CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';

const criarLinkSchema = z.object({
  nome: z.string().min(1, 'Informe um nome para o link'),
  escopoContaEmissora: z.enum(CONTAS_EMISSORAS_VALIDAS).optional(),
  expiraEm: z.string().datetime().optional(),
});

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'financeiro']);
  const links = await listarLinks();
  return Response.json(links);
});

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  const parsed = criarLinkSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const link = await criarLink(sessao.userId, parsed.data);
  return Response.json(link, { status: 201 });
});
