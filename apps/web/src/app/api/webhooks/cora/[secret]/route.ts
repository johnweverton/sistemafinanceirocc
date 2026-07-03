// POST /api/webhooks/cora/[secret] — recebe o webhook de pagamento do Cora e dá baixa no boleto.
// Rota PÚBLICA (sem sessão; excluída do middleware). Segurança em profundidade (Épico 4, §3/§5.2/§7):
//   1. secret no path comparado em tempo constante (CORA_WEBHOOK_SECRET).
//   2. idempotência via boleto_eventos.evento_id (reentrega do Cora não reprocessa).
//   3. RECONSULTA na API Cora (consultarInvoice) — fonte da verdade; NUNCA confia no corpo.
//   4. sempre responde 200 (exceto 401 de secret inválido) para não gerar tempestade de retries.
import { timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '@/lib/env';
import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';
import {
  registrarEvento,
  registrarBaixa,
  buscarBoletoPorIdExterno,
} from '@/server/repositories/boleto-repository';
import type { StatusBoleto } from '@cobranca/shared';

/** Comparação em tempo constante de dois segredos (evita timing attack). */
function segredosBatem(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parser TOLERANTE do corpo do evento do Cora (formato real a confirmar). Extrai o id da invoice,
 * o id do evento (idempotência) e o tipo. Isolado para ajuste único quando a API for confirmada.
 */
function extrairEvento(body: unknown): { idExterno: string | null; eventoId: string | null; eventoTipo: string | null } {
  const b = (body ?? {}) as Record<string, any>;
  const resource = (b.resource ?? b.data ?? b.invoice ?? {}) as Record<string, any>;
  const idExterno = resource.id ?? b.invoice_id ?? b.resource_id ?? null;
  const eventoId = b.event_id ?? b.idempotency_key ?? b.id ?? null;
  const eventoTipo = b.event ?? b.type ?? b.event_type ?? null;
  return {
    idExterno: idExterno != null ? String(idExterno) : null,
    eventoId: eventoId != null ? String(eventoId) : null,
    eventoTipo: eventoTipo != null ? String(eventoTipo) : null,
  };
}

export async function POST(req: Request, { params }: { params: { secret: string } }) {
  const env = getServerEnv();
  // 1. Secret do path (constant-time). Sem secret configurado ou divergente → 401.
  if (!env.CORA_WEBHOOK_SECRET || !segredosBatem(params.secret, env.CORA_WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const { idExterno, eventoId, eventoTipo } = extrairEvento(body);

  try {
    const boleto = idExterno ? await buscarBoletoPorIdExterno(idExterno) : null;

    // 2. Idempotência: registra o evento; se já visto, não reprocessa.
    const { novo } = await registrarEvento({
      boletoId: boleto?.id ?? null,
      idExterno,
      eventoId,
      eventoTipo,
      payload: body,
    });
    if (!novo) return Response.json({ ok: true, deduped: true });

    // Evento sem id externo — nada a conciliar (fica logado para investigação).
    if (!idExterno) return Response.json({ ok: true, semIdExterno: true });

    // 3. Reconsulta na Cora (fonte da verdade — não confiar no corpo do webhook).
    const { gateway } = criarBoletoGateway();
    const invoice = await gateway.consultarInvoice(idExterno);

    let statusBaixa: StatusBoleto | null = null;
    if (invoice.status === 'paid') statusBaixa = 'pago';
    else if (invoice.status === 'canceled') statusBaixa = 'cancelado';

    if (statusBaixa) {
      await registrarBaixa(idExterno, {
        status: statusBaixa,
        pagoEm: statusBaixa === 'pago' ? (invoice.pagoEm ?? new Date().toISOString()) : null,
        valorPago: statusBaixa === 'pago' ? invoice.valorPago : null,
      });
    }

    return Response.json({ ok: true });
  } catch (e) {
    // 4. Erro interno: loga mas responde 200 (o Cora não deve reenviar em loop).
    console.error(JSON.stringify({ webhook: 'cora', error: e instanceof Error ? e.message : String(e) }));
    return Response.json({ ok: true });
  }
}
