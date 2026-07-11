// POST /api/extrato/[id]/desfazer — reverte conciliação/ignorado/sugestão para 'sem_match'
// (Story 8.2, AC 4). Tudo na conciliação é reversível (D2): desfazer limpa o vínculo
// (libera o boleto para novo matching) e a trilha.
import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import {
  buscarTransacao,
  atualizarStatusConciliacao,
} from '@/server/repositories/extrato-repository';

const desfazerLimiter = createRateLimiter('extrato-desfazer', { limit: 30, windowMs: 60_000 });

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(desfazerLimiter, sessao.userId, 'desfazer conciliação');

  const transacao = await buscarTransacao(params.id);
  if (!transacao) {
    throw new ApiError(404, 'Transação do extrato não encontrada', 'TRANSACAO_NAO_ENCONTRADA');
  }
  if (transacao.statusConciliacao === 'sem_match') {
    throw new ApiError(409, 'Nada a desfazer — transação sem vínculo.', 'NADA_A_DESFAZER');
  }

  const atualizada = await atualizarStatusConciliacao(transacao.id, { status: 'sem_match' });

  return NextResponse.json({ transacao: atualizada });
});
