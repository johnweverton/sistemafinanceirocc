// GET /api/boletos/[id]/pdf — devolve a URL pública do PDF do boleto (bank_slip da Cora).
// Permite baixar/visualizar o boleto no painel de Recebíveis e reenviar manualmente quando o
// disparo automático (WhatsApp/e-mail) falha. A URL vem do payload_resposta da emissão
// (payment_options.bank_slip.url) — nenhuma migration necessária.
import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { buscarBoleto } from '@/server/repositories/boleto-repository';

/** Extrai a URL do PDF e as linhas de cobrança do payload cru da Cora (ausentes em mock/falha). */
function extrairBankSlip(payload: unknown): { url: string; digitable: string | null } | null {
  const p = (payload ?? {}) as Record<string, any>;
  const slip = p?.payment_options?.bank_slip;
  if (!slip || typeof slip.url !== 'string' || slip.url === '') return null;
  return { url: slip.url, digitable: typeof slip.digitable === 'string' ? slip.digitable : null };
}

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'financeiro']);

  const boleto = await buscarBoleto(params.id);
  if (!boleto) {
    throw new ApiError(404, 'Boleto não encontrado', 'BOLETO_NAO_ENCONTRADO');
  }

  const bankSlip = extrairBankSlip(boleto.payloadResposta);
  if (!bankSlip) {
    // Falha de emissão ou gateway mock — não há PDF para baixar.
    throw new ApiError(
      404,
      'Este boleto não tem PDF disponível (emissão falhou ou gateway de teste).',
      'PDF_INDISPONIVEL',
    );
  }

  return NextResponse.json({ url: bankSlip.url, digitable: bankSlip.digitable });
});
