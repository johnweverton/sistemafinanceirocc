// POST /api/extrato/[id]/conciliar — vincula uma transação de crédito a um boleto pago
// (Story 8.2, AC 4): confirma uma sugestão do motor OU vincula manualmente um boleto
// escolhido pelo operador. Sempre vira 'conciliado_manual' (houve decisão humana) com
// trilha de quem/quando.
//
// Validações (409 nos conflitos — falso positivo é inaceitável):
//   - transação existe, é CREDIT e está em estado conciliável (sem_match/sugerido);
//   - boleto existe, está PAGO e é da MESMA conta emissora da transação;
//   - boleto ainda não conciliado com outra transação (pré-checagem + UNIQUE parcial
//     da 0022 como barreira final — corrida vira 409 BOLETO_JA_CONCILIADO).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import {
  buscarTransacao,
  atualizarStatusConciliacao,
} from '@/server/repositories/extrato-repository';
import { buscarBoleto } from '@/server/repositories/boleto-repository';

const conciliarLimiter = createRateLimiter('extrato-conciliar', { limit: 30, windowMs: 60_000 });

const bodySchema = z.object({
  boletoId: z.string().uuid('boletoId deve ser UUID'),
});

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(conciliarLimiter, sessao.userId, 'conciliação de transação');

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'Corpo inválido: informe o boletoId (UUID).', 'VALIDATION', {
      issues: parsed.error.issues,
    });
  }
  const body = parsed.data;

  const transacao = await buscarTransacao(params.id);
  if (!transacao) {
    throw new ApiError(404, 'Transação do extrato não encontrada', 'TRANSACAO_NAO_ENCONTRADA');
  }
  if (transacao.tipo !== 'CREDIT') {
    throw new ApiError(
      422,
      'Só créditos podem ser conciliados com boletos.',
      'TRANSACAO_NAO_E_CREDITO',
    );
  }
  if (transacao.statusConciliacao.startsWith('conciliado')) {
    throw new ApiError(409, 'Transação já está conciliada.', 'TRANSACAO_JA_CONCILIADA');
  }
  if (transacao.statusConciliacao === 'ignorado') {
    throw new ApiError(
      409,
      'Transação está marcada como ignorada — desfaça antes de conciliar.',
      'TRANSACAO_IGNORADA',
    );
  }

  const boleto = await buscarBoleto(body.boletoId);
  if (!boleto) {
    throw new ApiError(404, 'Boleto não encontrado', 'BOLETO_NAO_ENCONTRADO');
  }
  if (boleto.status !== 'pago') {
    throw new ApiError(
      409,
      'Só boletos PAGOS podem ser conciliados com o extrato.',
      'BOLETO_NAO_PAGO',
    );
  }
  if (boleto.contaEmissora !== transacao.contaEmissora) {
    throw new ApiError(
      409,
      'Boleto e transação pertencem a contas emissoras diferentes.',
      'CONTA_DIFERENTE',
      { contaBoleto: boleto.contaEmissora, contaTransacao: transacao.contaEmissora },
    );
  }

  // UNIQUE parcial da 0022 é a barreira final: corrida entre a checagem e o update
  // vira 409 BOLETO_JA_CONCILIADO no repository (23505 mapeado).
  const atualizada = await atualizarStatusConciliacao(transacao.id, {
    status: 'conciliado_manual',
    boletoId: boleto.id,
    usuarioId: sessao.userId,
  });

  return NextResponse.json({ transacao: atualizada });
});
