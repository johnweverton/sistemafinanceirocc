// GET /api/recebiveis — lista Contas a Receber (admin/financeiro), com filtros por querystring.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarRecebiveis } from '@/server/repositories/recebiveis-repository';
import type { FiltroRecebiveis, StatusRecebivel } from '@cobranca/shared';

const STATUS_VALIDOS: StatusRecebivel[] = ['pago', 'cancelado', 'vencido', 'em_aberto'];

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);

  const statusParam = url.searchParams.get('status');
  const filtros: FiltroRecebiveis = {
    competencia: url.searchParams.get('competencia') ?? undefined,
    medicoId: url.searchParams.get('medico') ?? undefined,
    statusDerivado:
      statusParam && STATUS_VALIDOS.includes(statusParam as StatusRecebivel)
        ? (statusParam as StatusRecebivel)
        : undefined,
  };

  const recebiveis = await listarRecebiveis(filtros);
  return Response.json(recebiveis);
});
