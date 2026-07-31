// POST /api/boletos/lotes/[id]/processar — endpoint INTERNO (não exposto na UI). Processa o
// próximo lote de itens pendentes e, se houver mais, encadeia a si mesmo. Protegido por
// segredo interno — mesmo padrão de execucoes/[id]/processar-lote/route.ts.
import { timingSafeEqual } from 'node:crypto';
import { dispararProcessamentoLoteEmissao } from '@/server/orchestrator/emissao-lote-orchestrator';
import { getServerEnv } from '@/lib/env';
import { logAuthFailure } from '@/lib/security-logger';

/** Compara dois segredos em tempo constante (evita timing attack na descoberta do segredo). */
function segredosBatem(recebido: string | null, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Cada item é uma escrita financeira irreversível (mTLS + OAuth + POST invoice + Zappy + SMTP).
// Com EMISSAO_LOTE_CONCORRENCIA=3 e ~5s/item, um lote de 25 itens cabe folgado nos 300s do
// plano Vercel Pro (mesmo orçamento de processar-lote de execução).
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const env = getServerEnv();
  const secret = req.headers.get('x-internal-secret');
  if (!env.INTERNAL_SECRET || !segredosBatem(secret, env.INTERNAL_SECRET)) {
    logAuthFailure(req, 'Segredo interno de lote de emissão inválido ou ausente');
    return new Response('Unauthorized', { status: 401 });
  }

  await dispararProcessamentoLoteEmissao(params.id);
  return Response.json({ ok: true });
}
