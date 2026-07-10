// POST /api/boletos/[id]/cancelar — cancelamento ativo de boleto (Story 6.1).
// Regras de negócio:
//   1. Só admin/financeiro, com rate limit (mesmo padrão da emissão).
//   2. Só boleto com status 'emitido' é cancelável; 'pago' → 409, 'cancelado' → 409
//      idempotente, 'falha' → 422 (nada a cancelar no gateway).
//   3. RECONSULTA obrigatória na Cora ANTES de cancelar — se pagou entre a tela e o clique,
//      NÃO cancela: sincroniza a baixa (mesmo efeito do webhook) e retorna 409.
//   4. Motivo é obrigatório (trilha de auditoria: quem/quando/por quê).
//   5. Cancelamento é sempre cancelar + reemitir — nunca edição (decisão do Épico 6).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';
import {
  buscarBoleto,
  cancelarBoleto,
  registrarBaixa,
  registrarEvento,
} from '@/server/repositories/boleto-repository';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';

// A rota encadeia 3 round-trips mTLS na Cora (token → reconsulta → DELETE). Limita a function
// a 60s (em vez do teto de 300s da Vercel) para falhar rápido em vez de deixar o navegador
// preso em "Cancelando…" — mesmo orçamento da rota de emissão; cabe folgado com o timeout
// de 10s por chamada mTLS.
export const maxDuration = 60;

// Mesmo limite da emissão: máximo 10 cancelamentos por minuto por usuário.
const cancelarLimiter = createRateLimiter('boletos-cancelar', { limit: 10, windowMs: 60_000 });

const bodySchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, 'Informe o motivo do cancelamento (mínimo 5 caracteres).')
    .max(500, 'Motivo muito longo (máximo 500 caracteres).'),
});

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  // 1. Auth + rate limit.
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(cancelarLimiter, sessao.userId, 'cancelamento de boleto');

  // 2. Motivo obrigatório.
  const body = bodySchema.parse(await req.json());

  // 3. Boleto precisa existir.
  const boleto = await buscarBoleto(params.id);
  if (!boleto) {
    throw new ApiError(404, 'Boleto não encontrado', 'BOLETO_NAO_ENCONTRADO');
  }

  // 4. Validações de estado local.
  if (boleto.status === 'pago') {
    throw new ApiError(409, 'Boleto já foi pago — não pode ser cancelado.', 'BOLETO_PAGO');
  }
  if (boleto.status === 'cancelado') {
    // Idempotente: cancelar duas vezes não é erro de dado, mas sinaliza que nada foi feito.
    throw new ApiError(409, 'Boleto já está cancelado.', 'BOLETO_JA_CANCELADO');
  }
  if (boleto.status === 'falha') {
    throw new ApiError(
      422,
      'Boleto com falha de emissão não existe no gateway — nada a cancelar. Emita novamente.',
      'BOLETO_FALHA_NAO_CANCELAVEL',
    );
  }
  if (!boleto.idExterno) {
    // Defensivo: 'emitido' sem id externo é estado inconsistente — não dá para cancelar na Cora.
    throw new ApiError(422, 'Boleto sem id externo do gateway — verificar auditoria.', 'SEM_ID_EXTERNO');
  }

  const { gateway } = criarBoletoGateway();

  // 5. Reconsulta na Cora (fonte da verdade) — pagamento pode ter ocorrido entre a tela e o clique.
  const invoice = await gateway.consultarInvoice(boleto.idExterno);
  if (invoice.status === 'paid') {
    // Não cancela: sincroniza a baixa localmente (mesmo caminho do webhook) e recusa.
    await registrarBaixa(boleto.idExterno, {
      status: 'pago',
      pagoEm: invoice.pagoEm ?? new Date().toISOString(),
      valorPago: invoice.valorPago,
    });
    throw new ApiError(
      409,
      'Boleto foi pago na Cora — baixa sincronizada; não é possível cancelar.',
      'BOLETO_PAGO',
    );
  }
  if (invoice.status === 'canceled') {
    // Já cancelado na Cora (ex.: manualmente no internet banking) — sincroniza o estado local
    // com a trilha de auditoria desta ação e devolve sucesso idempotente.
    const atualizado = await cancelarBoleto(boleto.id, {
      canceladoPor: sessao.userId,
      motivo: body.motivo,
    });
    await registrarEvento({
      boletoId: boleto.id,
      idExterno: boleto.idExterno,
      eventoId: null,
      eventoTipo: 'cancelamento.manual',
      statusReconsultado: invoice.status,
      payload: { jaCanceladoNaCora: true },
    });
    return NextResponse.json({ boleto: atualizado, jaCanceladoNaCora: true }, { status: 200 });
  }
  // 'open' | 'overdue' | 'unknown' → prossegue. Em 'unknown' a Cora ainda é a barreira final:
  // o DELETE falha lá se a invoice estiver paga (contrato oficial), então nunca cancelamos um pago.

  // 6. Cancelar no gateway.
  const resultado = await gateway.cancelar(boleto.idExterno);
  if (!resultado.sucesso) {
    // Auditoria mesmo em falha: evento registrado com o payload cru do gateway.
    await registrarEvento({
      boletoId: boleto.id,
      idExterno: boleto.idExterno,
      eventoId: null,
      eventoTipo: 'cancelamento.manual.falha',
      statusReconsultado: invoice.status,
      payload: resultado.payloadResposta,
    });
    throw new ApiError(
      502,
      'A Cora recusou o cancelamento — verificar o status do boleto no gateway.',
      'CANCELAMENTO_FALHOU',
      { gateway: resultado.payloadResposta },
    );
  }

  // 7. Persistir estado + trilha de auditoria (payload do gateway vai para boleto_eventos —
  //    o payload_resposta da EMISSÃO permanece intacto no registro do boleto).
  const atualizado = await cancelarBoleto(boleto.id, {
    canceladoPor: sessao.userId,
    motivo: body.motivo,
  });
  await registrarEvento({
    boletoId: boleto.id,
    idExterno: boleto.idExterno,
    eventoId: null,
    eventoTipo: 'cancelamento.manual',
    statusReconsultado: invoice.status,
    payload: resultado.payloadResposta,
  });

  return NextResponse.json({ boleto: atualizado }, { status: 200 });
});
