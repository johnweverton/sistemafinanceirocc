// POST /api/boletos/lotes/[id]/confirmar — Fase B (revisão de arquitetura 2026-07-31, decisão
// 5). Único clique que autoriza o lote; o processamento em si acontece depois, assíncrono.
//
// Segurança (decisão 4):
//   - Só ADMIN confirma (preview pode ser criado por admin OU financeiro — quem opera precisa
//     poder conferir; a autorização de quem EXECUTA a emissão em massa escala com o raio de
//     impacto da ação, maior que o de uma emissão individual).
//   - Revalida o snapshot: o cliente envia `totalItens`/`totalValor` que viu no preview: se
//     divergir do que está gravado (alguém revisou um alerta, cancelou um boleto, mudou um
//     cadastro nesse meio-tempo), 409 — o operador precisa buscar um preview novo. Sem isso, a
//     confirmação seria "decorativa": mostra uma coisa, emite outra.
//   - Expira sozinho depois de 30 min sem confirmação (evita confirmar um preview velho cujos
//     dados podem ter mudado silenciosamente).
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import { buscarLote, confirmarLote, expirarLote } from '@/server/repositories/lote-emissao-repository';
import { dispararProcessamentoLoteEmissao } from '@/server/orchestrator/emissao-lote-orchestrator';

const LOTE_EXPIRA_MS = 30 * 60_000;
// Mesmo espírito do limite de criação — é o disparo de verdade, deve ser raro por sessão.
const confirmarLimiter = createRateLimiter('boletos-lote-confirmar', { limit: 3, windowMs: 3_600_000 });

const bodySchema = z.object({
  totalItens: z.number().int().nonnegative(),
  totalValor: z.number().nonnegative(),
});

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin']);
  assertRateLimit(confirmarLimiter, sessao.userId, 'confirmação de lote de emissão');

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Payload inválido', 'VALIDATION', { issues: parsed.error.issues });
  }

  const lote = await buscarLote(params.id);
  if (!lote) throw new ApiError(404, 'Lote de emissão não encontrado', 'LOTE_NAO_ENCONTRADO');

  if (lote.status !== 'aguardando_confirmacao') {
    throw new ApiError(
      409,
      `Lote não está aguardando confirmação (status atual: '${lote.status}').`,
      'LOTE_NAO_CONFIRMAVEL',
    );
  }

  const idadeMs = Date.now() - new Date(lote.criadoEm).getTime();
  if (idadeMs > LOTE_EXPIRA_MS) {
    await expirarLote(lote.id);
    throw new ApiError(
      409,
      'Este preview expirou (mais de 30 minutos). Gere um preview novo antes de confirmar.',
      'LOTE_EXPIRADO',
    );
  }

  // Revalidação do snapshot — barreira contra confirmar "às cegas" (decisão 4). Valor com
  // tolerância de 1 centavo (arredondamento de soma em ponto flutuante).
  const divergiu =
    parsed.data.totalItens !== lote.snapshotTotalItens ||
    Math.abs(parsed.data.totalValor - lote.snapshotTotalValor) > 0.01;
  if (divergiu) {
    throw new ApiError(
      409,
      'O resumo mudou desde que o preview foi gerado. Gere um preview novo antes de confirmar.',
      'SNAPSHOT_DIVERGENTE',
      {
        snapshotAtual: { totalItens: lote.snapshotTotalItens, totalValor: lote.snapshotTotalValor },
      },
    );
  }

  const confirmado = await confirmarLote(lote.id, sessao.userId);
  if (!confirmado) {
    // Corrida: outra requisição confirmou/expirou entre o buscarLote acima e agora.
    throw new ApiError(409, 'Lote não está mais aguardando confirmação.', 'LOTE_NAO_CONFIRMAVEL');
  }

  // Fire-and-forget: dispara o processamento sem aguardar (mesmo padrão de POST /api/execucoes).
  void dispararProcessamentoLoteEmissao(confirmado.id);

  return Response.json({ lote: confirmado }, { status: 202 });
});
