// POST /api/webhooks/cora/[secret] — recebe o webhook de pagamento do Cora e dá baixa no boleto.
// Rota PÚBLICA (sem sessão; excluída do middleware). Segurança em profundidade (Épico 4, §3/§5.2/§7):
//   1. secret no path comparado em tempo constante contra o secret de CADA conta emissora
//      configurada (Story 7.2, ampliado 2026-08-03 para N contas via CONTAS_EMISSORAS —
//      contas sem credenciais são ignoradas). Qualquer match autentica; a conta da RECONSULTA
//      não vem do secret — vem do boleto (ver 3).
//   2. idempotência via boleto_eventos.evento_id (reentrega do Cora não reprocessa).
//   3. RECONSULTA na API Cora (consultarInvoice) — fonte da verdade; NUNCA confia no corpo.
//      A conta usada é a GRAVADA NO BOLETO (boletos.conta_emissora, arquitetura §2-D3);
//      evento cujo id externo não casa com boleto nenhum não é reconsultado (não há como
//      saber a conta) — fica logado em boleto_eventos para investigação, como antes.
//   4. sempre responde 200 (exceto 401 de secret inválido) para não gerar tempestade de retries.
import { timingSafeEqual } from 'node:crypto';
import { getCredenciaisConta } from '@/lib/env';
import { CONTAS_EMISSORAS } from '@/server/gateway/contas-emissoras';
import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';
import {
  registrarEvento,
  registrarBaixa,
  buscarBoletoPorIdExterno,
} from '@/server/repositories/boleto-repository';
import { logAuthFailure, logSecurityError, logWebhookReceived } from '@/lib/security-logger';
import type { StatusBoleto } from '@cobranca/shared';

/** Webhook secrets de todas as contas CONFIGURADAS (contas sem credenciais são ignoradas —
 *  mesma degradação por conta do resto do gateway). Lido a cada request: env não muda em
 *  runtime, o custo é resolver poucas vars, e evita cache furado por hot-reload em dev. */
function secretsConfigurados(): string[] {
  const secrets: string[] = [];
  for (const conta of Object.keys(CONTAS_EMISSORAS) as (keyof typeof CONTAS_EMISSORAS)[]) {
    try {
      const { webhookSecret } = getCredenciaisConta(conta);
      if (webhookSecret) secrets.push(webhookSecret);
    } catch {
      // Conta sem credenciais configuradas — não participa da autenticação do webhook.
    }
  }
  return secrets;
}

/** Comparação em tempo constante de dois segredos (evita timing attack). */
function segredosBatem(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Extrai o evento dos HEADERS da notificação — contrato REAL confirmado na doc oficial
 * ("Exemplo de POST da Notificação", pesquisa 2026-07-10): o POST da Cora chega com
 * `content-length: 0` e os dados em `webhook-event-id` / `webhook-event-type` /
 * `webhook-resource-id`. Isso explica os webhooks "vazios" recebidos em produção em
 * 2026-07-10 — a rota só lia o corpo e perdia o idExterno.
 */
function extrairEventoDosHeaders(req: Request): {
  idExterno: string | null;
  eventoId: string | null;
  eventoTipo: string | null;
} {
  return {
    idExterno: req.headers.get('webhook-resource-id'),
    eventoId: req.headers.get('webhook-event-id'),
    eventoTipo: req.headers.get('webhook-event-type'),
  };
}

/**
 * Parser TOLERANTE do corpo do evento do Cora — FALLBACK quando os headers não vierem
 * (formatos antigos/alternativos; ver extrairEventoDosHeaders para o contrato primário).
 */
function extrairEvento(body: unknown): { idExterno: string | null; eventoId: string | null; eventoTipo: string | null } {
  const b = (body ?? {}) as Record<string, any>;
  const resource = (b.resource ?? b.data ?? b.invoice ?? {}) as Record<string, any>;
  const idExternoRaw = resource.id ?? b.invoice_id ?? b.resource_id ?? null;
  const eventoTipoRaw = b.event ?? b.type ?? b.event_type ?? null;

  const idExterno = idExternoRaw != null ? String(idExternoRaw) : null;
  const eventoTipo = eventoTipoRaw != null ? String(eventoTipoRaw) : null;

  // Idempotência: preferir um id de evento NATIVO do Cora. NÃO usar `b.id` como fallback — ele pode
  // ser o id da INVOICE, o que faria dois eventos distintos da mesma invoice (paid → canceled)
  // colidirem no dedupe e o 2º ser perdido (QA 4.3, MEDIUM). Sem id nativo, deriva uma chave
  // COMPOSTA estável por tipo+invoice+timestamp: paid e canceled da mesma invoice ficam distintos,
  // e reentregas do MESMO evento (mesmo tipo+invoice+timestamp) ainda deduplicam.
  const eventoNativo = b.event_id ?? b.idempotency_key ?? null;
  const eventoId =
    eventoNativo != null
      ? String(eventoNativo)
      : eventoTipo && idExterno
        ? `${eventoTipo}:${idExterno}:${String(b.occurred_at ?? b.created_at ?? '')}`
        : null;

  return { idExterno, eventoId, eventoTipo };
}

// Warn único por instância: secrets iguais entre contas anulam a separação (mitigação
// de risco da Story 7.2) — não bloqueia, mas fica visível no log da function.
let avisouSecretsIguais = false;

export async function POST(req: Request, { params }: { params: { secret: string } }) {
  // 1. Secret do path (constant-time) contra o secret de cada conta emissora configurada.
  const secrets = secretsConfigurados();
  if (new Set(secrets).size !== secrets.length && !avisouSecretsIguais) {
    avisouSecretsIguais = true;
    console.warn('[Webhook Cora] Duas ou mais contas emissoras têm o MESMO secret — configure um secret distinto por conta.');
  }
  if (secrets.length === 0 || !secrets.some((s) => segredosBatem(params.secret, s))) {
    logAuthFailure(req, 'Secret do webhook Cora inválido ou ausente');
    return new Response('Unauthorized', { status: 401 });
  }

  // Lê como TEXTO primeiro: se o JSON falhar, o corpo cru fica na auditoria (boleto_eventos.payload)
  // em vez de um {} mudo. (Mistério dos webhooks "vazios" de 2026-07-10 RESOLVIDO: o corpo
  // vazio é o contrato normal da Cora — os dados vêm nos headers.)
  let body: unknown = {};
  let corpoCru = '';
  try {
    corpoCru = await req.text();
    body = corpoCru ? JSON.parse(corpoCru) : {};
  } catch {
    body = { _parseError: true, _raw: corpoCru.slice(0, 2000) };
  }

  // Headers são a fonte PRIMÁRIA (contrato oficial); corpo é fallback campo a campo.
  // O webhook-event-id nativo ancora a idempotência — melhor que a chave composta derivada.
  const dosHeaders = extrairEventoDosHeaders(req);
  const doCorpo = extrairEvento(body);
  const idExterno = dosHeaders.idExterno ?? doCorpo.idExterno;
  const eventoId = dosHeaders.eventoId ?? doCorpo.eventoId;
  const eventoTipo = dosHeaders.eventoTipo ?? doCorpo.eventoTipo;

  // Auditoria nunca fica muda: sem corpo, grava o snapshot dos headers do evento.
  const payloadAuditoria = corpoCru
    ? body
    : { _corpoVazio: true, headers: dosHeaders };

  try {
    const boleto = idExterno ? await buscarBoletoPorIdExterno(idExterno) : null;

    // 2. Idempotência: registra o evento; se já visto, não reprocessa.
    const { novo } = await registrarEvento({
      boletoId: boleto?.id ?? null,
      idExterno,
      eventoId,
      eventoTipo,
      payload: payloadAuditoria,
    });

    // Achado I-2: Log estruturado
    logWebhookReceived('cora', eventoTipo, !novo);

    // `success: true` é o formato de resposta esperado pela Cora (doc oficial);
    // os campos extras (ok/deduped/...) são nossos, para observabilidade.
    if (!novo) return Response.json({ success: true, ok: true, deduped: true });

    // Evento sem id externo — nada a conciliar (fica logado para investigação).
    if (!idExterno) return Response.json({ success: true, ok: true, semIdExterno: true });

    // Evento órfão (id externo sem boleto nosso): sem boleto não há conta emissora para
    // reconsultar (Story 7.2) — registra e encerra, como qualquer evento não conciliável.
    if (!boleto) return Response.json({ success: true, ok: true, semBoleto: true });

    // 3. Reconsulta na Cora (fonte da verdade — não confiar no corpo do webhook), SEMPRE
    //    pela conta que emitiu o boleto — nunca a do secret nem a atual do médico.
    const { gateway } = criarBoletoGateway(boleto.contaEmissora);
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

    return Response.json({ success: true, ok: true });
  } catch (e) {
    // 4. Erro interno: loga mas responde 200 (o Cora não deve reenviar em loop).
    logSecurityError('WEBHOOK_CORA_ERRO', e, { webhook: 'cora' });
    return Response.json({ success: true, ok: true });
  }
}

