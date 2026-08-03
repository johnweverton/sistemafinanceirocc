// POST /api/extrato/[id]/ignorar — marca uma transação como sem relação com boletos
// (tarifa, transferência interna, recebimento avulso…) — Story 8.2, AC 4. Reversível
// (desfazer) e com trilha de quem/quando (conciliado_por/conciliado_em).
//
// O motivo é opcional no corpo e NÃO é persistido na v1 (não há coluna própria e o
// payload jsonb é auditoria crua da API — não se mistura). Se a coordenação precisar
// do motivo, é uma coluna aditiva em migration futura.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import {
  buscarTransacao,
  atualizarStatusConciliacao,
} from '@/server/repositories/extrato-repository';

const ignorarLimiter = createRateLimiter('extrato-ignorar', { limit: 30, windowMs: 60_000 });

const bodySchema = z.object({
  motivo: z.string().trim().max(500, 'Motivo muito longo (máximo 500 caracteres).').optional(),
});

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(ignorarLimiter, sessao.userId, 'ignorar transação do extrato');

  // Corpo pode vir vazio — motivo é opcional.
  const texto = await req.text();
  const parsed = bodySchema.safeParse(texto ? JSON.parse(texto) : {});
  if (!parsed.success) {
    throw new ApiError(400, 'Corpo inválido.', 'VALIDATION', { issues: parsed.error.issues });
  }

  const transacao = await buscarTransacao(params.id);
  if (!transacao) {
    throw new ApiError(404, 'Transação do extrato não encontrada', 'TRANSACAO_NAO_ENCONTRADA');
  }
  if (transacao.statusConciliacao.startsWith('conciliado')) {
    throw new ApiError(
      409,
      'Transação conciliada não pode ser ignorada. Desfaça a conciliação antes.',
      'TRANSACAO_JA_CONCILIADA',
    );
  }
  if (transacao.statusConciliacao === 'ignorado') {
    throw new ApiError(409, 'Transação já está ignorada.', 'TRANSACAO_JA_IGNORADA');
  }

  const atualizada = await atualizarStatusConciliacao(transacao.id, {
    status: 'ignorado',
    usuarioId: sessao.userId,
  });

  return NextResponse.json({ transacao: atualizada });
});
