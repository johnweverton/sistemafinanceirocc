// POST /api/execucoes/[id]/processar-lote — endpoint INTERNO (não exposto na UI).
// Processa o próximo lote e, se houver mais, encadeia a si mesmo. Protegido por segredo
// interno, nunca exposto ao browser (architecture: API Specification, Core Workflows).
import { dispararPrimeiroLote } from '@/server/orchestrator/execucao-orchestrator';
import { getServerEnv } from '@/lib/env';

// Calibrado para 120 médicos/competência — pior caso ~30s/lote, dentro de 60s.
// Revisitar se o volume mensal passar de ~200 médicos (architecture: Core Workflows).
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const env = getServerEnv();
  const secret = req.headers.get('x-internal-secret');
  if (!env.INTERNAL_SECRET || secret !== env.INTERNAL_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  // dispararPrimeiroLote encapsula processarProximoLote + try/marcarErro; serve para
  // qualquer lote (não só o primeiro). O encadeamento do próximo lote acontece dentro
  // de processarProximoLote → agendarProximoLote quando ainda há médicos pendentes.
  await dispararPrimeiroLote(params.id);
  return Response.json({ ok: true });
}
