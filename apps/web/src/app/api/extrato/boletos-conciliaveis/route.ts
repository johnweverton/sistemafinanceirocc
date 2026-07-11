// GET /api/extrato/boletos-conciliaveis?conta= — boletos PAGOS da conta ainda livres
// (sem transação conciliada) para o diálogo "Vincular boleto" da página /extrato
// (Story 8.3). Reusa a vw_recebiveis (nome/valor/competência prontos para exibição).
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarRecebiveis } from '@/server/repositories/recebiveis-repository';
import { boletoIdsConciliados } from '@/server/repositories/extrato-repository';
import { CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';

const querySchema = z.object({
  conta: z.enum(CONTAS_EMISSORAS_VALIDAS),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const query = querySchema.safeParse({ conta: url.searchParams.get('conta') ?? undefined });
  if (!query.success) {
    throw new ApiError(400, 'Informe a conta emissora (conta=mc|cavalcante_viana).', 'VALIDATION', {
      issues: query.error.issues,
    });
  }

  const [pagos, ocupados] = await Promise.all([
    listarRecebiveis({ contaEmissora: query.data.conta, statusDerivado: 'pago' }),
    boletoIdsConciliados(),
  ]);

  return Response.json(pagos.filter((r) => !ocupados.has(r.boletoId)));
});
