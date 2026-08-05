// GET /api/execucoes — histórico (PRD §8.5). POST — dispara e aguarda o 1º lote (achado
// 2026-08-05: fire-and-forget sem aguardar deixava a function ser suspensa pela Vercel antes
// do cálculo terminar, travando a execução em "processando" pra sempre sem erro nenhum — 2ª
// emissão "Por médico" seguida, ou lote pequeno, sem dar tempo de cold start "segurar" a
// promise solta). Igual ao padrão já usado em processar-lote/route.ts.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarExecucoes } from '@/server/repositories/execucao-repository';
import { iniciarExecucao, dispararPrimeiroLote } from '@/server/orchestrator/execucao-orchestrator';
import { dispararExecucaoSchema } from '@/server/validation/execucao-schema';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';

// Achado I-1: rate limit — máximo 3 disparos de execução por minuto por usuário.
const execucaoLimiter = createRateLimiter('execucoes-disparar', { limit: 3, windowMs: 60_000 });

// Mesmo calibre de processar-lote/route.ts: 120-150 médicos cabem em 1 lote só, dentro dos
// 300s do plano Vercel Pro — folga ampla mesmo aguardando aqui.
export const maxDuration = 300;

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const execucoes = await listarExecucoes();
  return Response.json(execucoes);
});

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'colaborador']);
  // Achado I-1: Protege contra disparo acidental múltiplo.
  assertRateLimit(execucaoLimiter, sessao.userId, 'disparo de execução');

  const parsed = dispararExecucaoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Payload inválido', 'VALIDATION', { issues: parsed.error.issues });
  }

  const execucao = await iniciarExecucao(
    parsed.data.competencia,
    parsed.data.selecoes,
    sessao.userId,
    undefined,
    parsed.data.empresaId,
    parsed.data.clienteContabilidadeId,
    parsed.data.ehAdicional,
  );

  // Aguarda o 1º lote terminar antes de responder (ver comentário do topo do arquivo).
  await dispararPrimeiroLote(execucao.id);

  return Response.json({ execucaoId: execucao.id });
});
