// POST /api/clientes-contabilidade/lote — cálculo em lote de clientes contábeis (feedback do
// dono, 2026-08-20): N clientes, 1 execução, N execucao_resultados. Mesmo padrão de
// POST /api/execucoes (aguarda o 1º "lote" terminar antes de responder — aqui não há
// encadeamento de verdade, cada cliente é só leitura local, cabe numa invocação só).
// A emissão em lote dos boletos resultantes reusa o mecanismo JÁ EXISTENTE (LoteEmissaoDialog +
// /api/boletos/lotes), que já é agnóstico de médico/empresa/cliente contábil — zero mudança lá.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { iniciarLoteClientesContabilidade, dispararPrimeiroLote } from '@/server/orchestrator/execucao-orchestrator';
import { dispararLoteClientesContabilidadeSchema } from '@/server/validation/execucao-schema';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';

const loteLimiter = createRateLimiter('clientes-contabilidade-lote', { limit: 3, windowMs: 60_000 });

// Mesmo calibre de /api/execucoes: folga ampla mesmo aguardando o cálculo do lote inteiro aqui.
export const maxDuration = 300;

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'colaborador']);
  assertRateLimit(loteLimiter, sessao.userId, 'lote de clientes contábeis');

  const parsed = dispararLoteClientesContabilidadeSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Payload inválido', 'VALIDATION', { issues: parsed.error.issues });
  }

  const execucao = await iniciarLoteClientesContabilidade(
    parsed.data.competencia,
    parsed.data.clienteContabilidadeIds,
    sessao.userId,
  );

  await dispararPrimeiroLote(execucao.id);

  return Response.json({ execucaoId: execucao.id });
});
