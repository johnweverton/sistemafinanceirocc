// POST /api/extrato/[id]/categorizar — categoriza uma transação do extrato (Story 9.2,
// AC 5). Body opcional `{ categoriaId }`:
//   - presente = correção/confirmação manual — SEMPRE aceita (mesmo sobre uma sugestão
//     ou sem_categoria), status vira 'confirmada';
//   - ausente = roda o motor de categorização (D3) só para ESSA transação — útil para
//     recategorizar sob demanda (ex.: depois de cadastrar uma regra nova). Se nenhuma
//     regra bater, a transação continua sem_categoria (nada é gravado).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import { buscarTransacao, categorizarTransacao } from '@/server/repositories/extrato-repository';
import { buscarCategoriasSistema, listarRegras } from '@/server/repositories/plano-contas-repository';
import { categorizar } from '@/server/engine/categorizacao';

const categorizarLimiter = createRateLimiter('extrato-categorizar', { limit: 30, windowMs: 60_000 });

const bodySchema = z.object({
  categoriaId: z.string().uuid('categoriaId deve ser UUID').optional(),
});

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(categorizarLimiter, sessao.userId, 'categorização de transação');

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(400, 'Corpo inválido: categoriaId deve ser UUID.', 'VALIDATION', {
      issues: parsed.error.issues,
    });
  }

  const transacao = await buscarTransacao(params.id);
  if (!transacao) {
    throw new ApiError(404, 'Transação do extrato não encontrada', 'TRANSACAO_NAO_ENCONTRADA');
  }

  if (parsed.data.categoriaId) {
    const atualizada = await categorizarTransacao(transacao.id, {
      categoriaId: parsed.data.categoriaId,
      status: 'confirmada',
    });
    return NextResponse.json({ transacao: atualizada });
  }

  const [categoriasSistema, regrasAtivas] = await Promise.all([
    buscarCategoriasSistema(),
    listarRegras({ ativo: true }),
  ]);
  const [resultado] = categorizar(
    [
      {
        transacaoId: transacao.id,
        tipo: transacao.tipo,
        transactionType: transacao.transactionType,
        contraparteNome: transacao.contraparteNome,
        descricao: transacao.descricao,
        conciliadaComBoleto: transacao.statusConciliacao.startsWith('conciliado'),
      },
    ],
    regrasAtivas.map((r) => ({
      categoriaId: r.categoriaId,
      campo: r.campo,
      padrao: r.padrao,
      prioridade: r.prioridade,
    })),
    categoriasSistema,
  );

  if (!resultado || resultado.status === 'sem_categoria' || !resultado.categoriaId) {
    return NextResponse.json({ transacao });
  }
  const atualizada = await categorizarTransacao(transacao.id, {
    categoriaId: resultado.categoriaId,
    status: resultado.status,
  });
  return NextResponse.json({ transacao: atualizada });
});
