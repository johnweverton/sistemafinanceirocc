// GET /api/recebiveis — lista Contas a Receber (admin/financeiro), com filtros por querystring.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarRecebiveis } from '@/server/repositories/recebiveis-repository';
import { listarDisparosPorBoletos } from '@/server/repositories/boleto-disparo-repository';
import type { FiltroRecebiveis } from '@cobranca/shared';

// Achado B-3: validar query params com Zod (whitelist de status válidos).
const recebiveisQuerySchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Formato esperado: YYYY-MM').optional(),
  medico: z.string().uuid('medico deve ser UUID').optional(),
  status: z.enum(['pago', 'cancelado', 'vencido', 'em_aberto']).optional(),
  // Filtro por empresa emissora (Story 7.3) — espelha a CHECK do banco.
  conta: z.enum(['mc', 'cavalcante_viana']).optional(),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const query = recebiveisQuerySchema.safeParse({
    competencia: url.searchParams.get('competencia') ?? undefined,
    medico: url.searchParams.get('medico') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    conta: url.searchParams.get('conta') ?? undefined,
  });
  if (!query.success) {
    throw new ApiError(400, 'Parâmetros de consulta inválidos', 'VALIDATION', { issues: query.error.issues });
  }

  const filtros: FiltroRecebiveis = {
    competencia: query.data.competencia,
    medicoId: query.data.medico,
    statusDerivado: query.data.status,
    contaEmissora: query.data.conta,
  };

  const recebiveis = await listarRecebiveis(filtros);

  // Anexa os disparos de notificação (badges WhatsApp/e-mail na UI) em uma única query.
  const disparosMap = await listarDisparosPorBoletos(recebiveis.map((r) => r.boletoId));
  for (const r of recebiveis) {
    r.disparos = (disparosMap[r.boletoId] ?? []).map((d) => ({
      canal: d.canal,
      status: d.status,
      mensagemErro: d.mensagem_erro,
      enviadoEm: d.enviado_em,
    }));
  }

  return Response.json(recebiveis);
});
