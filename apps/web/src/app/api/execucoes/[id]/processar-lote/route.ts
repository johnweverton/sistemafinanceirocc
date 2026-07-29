// POST /api/execucoes/[id]/processar-lote — endpoint INTERNO (não exposto na UI).
// Processa o próximo lote e, se houver mais, encadeia a si mesmo. Protegido por segredo
// interno, nunca exposto ao browser (architecture: API Specification, Core Workflows).
import { timingSafeEqual } from 'node:crypto';
import { dispararPrimeiroLote } from '@/server/orchestrator/execucao-orchestrator';
import { getServerEnv } from '@/lib/env';
import { logAuthFailure } from '@/lib/security-logger';

/** Compara dois segredos em tempo constante (evita timing attack na descoberta do segredo). */
function segredosBatem(recebido: string | null, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // timingSafeEqual exige mesmo tamanho; comprimentos diferentes já reprovam sem vazar timing.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Calibrado para 120-150 médicos/competência processados em paralelo (concorrência limitada,
// ver EXECUCAO_CONCORRENCIA_MEDICO em execucao-orchestrator.ts) — folga ampla dentro dos 300s
// do plano Vercel Pro. Revisitar se o volume mensal passar muito de ~150 médicos por lote.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const env = getServerEnv();
  const secret = req.headers.get('x-internal-secret');
  if (!env.INTERNAL_SECRET || !segredosBatem(secret, env.INTERNAL_SECRET)) {
    logAuthFailure(req, 'Segredo interno de lote inválido ou ausente');
    return new Response('Unauthorized', { status: 401 });
  }

  // dispararPrimeiroLote encapsula processarProximoLote + try/marcarErro; serve para
  // qualquer lote (não só o primeiro). O encadeamento do próximo lote acontece dentro
  // de processarProximoLote → agendarProximoLote quando ainda há médicos pendentes.
  await dispararPrimeiroLote(params.id);
  return Response.json({ ok: true });
}
