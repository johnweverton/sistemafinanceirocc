// POST /api/clientes-contabilidade/lote — cálculo em lote de clientes contábeis (feedback do
// dono, 2026-08-20): N clientes, 1 execução, N execucao_resultados.
// A emissão em lote dos boletos resultantes reusa o mecanismo JÁ EXISTENTE (LoteEmissaoDialog +
// /api/boletos/lotes), que já é agnóstico de médico/empresa/cliente contábil — zero mudança lá.
//
// Story 12.5 (R-3/G-06) — esta rota CRIA a execução e responde; NÃO processa mais o lote aqui.
// Antes ela aguardava `dispararPrimeiroLote` (mesmo padrão de POST /api/execucoes) e só então
// devolvia o `execucaoId`: até 300s em que o cliente tinha uma promise pendente e NENHUM
// identificador — sem barra de progresso possível, e com a rede caindo no meio o operador ficava
// sem saber sequer se havia uma execução. Agora o `execucaoId` existe (e é consultável) desde o
// primeiro instante; quem processa é o POST /api/execucoes/{id}/retomar que o diálogo chama em
// seguida — que TAMBÉM aguarda terminar antes de responder, então o achado de 2026-08-05
// (fire-and-forget sendo suspenso pela Vercel no meio do cálculo) continua evitado: em nenhum
// momento existe promise solta sem request segurando a function.
//
// Consequência deliberada: se o cliente morrer entre a criação e o processamento, a execução fica
// em `processando` com 0 resultados — visível no diálogo e no histórico, e retomável pelo botão
// "Reprocessar" de ProgressoExecucao. É estritamente melhor que o estado anterior (mesma falha,
// porém invisível e sem identificador).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { iniciarLoteClientesContabilidade } from '@/server/orchestrator/execucao-orchestrator';
import { dispararLoteClientesContabilidadeSchema } from '@/server/validation/execucao-schema';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import { LOTE_CONTABILIDADE_MAX_POR_MINUTO } from '@cobranca/shared';

// Limite exibido na UI antes do clique (Story 12.5, G-13) — fonte única em @cobranca/shared.
const loteLimiter = createRateLimiter('clientes-contabilidade-lote', {
  limit: LOTE_CONTABILIDADE_MAX_POR_MINUTO,
  windowMs: 60_000,
});

// A rota não processa mais o lote (ver comentário do topo), mas a criação da execução ainda
// escreve N seleções/linhas — folga mantida por segurança, sem custo quando não usada.
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

  return Response.json({ execucaoId: execucao.id });
});
