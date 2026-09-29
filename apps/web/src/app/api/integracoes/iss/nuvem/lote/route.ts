// POST /api/integracoes/iss/nuvem/lote — dispara o próximo lote da busca no ISS pela nuvem
// (server/iss-nuvem). Chamada pelo próprio lote anterior ao terminar; rota de MÁQUINA, mesmo bearer
// do agente (D2). Responde 202 na hora e o lote roda depois da resposta (waitUntil).
import { withErrorHandler } from '@/lib/api-error';
import { requireAgenteIssToken } from '@/server/auth/require-agente-token';
import { agendarLoteNuvemIss } from '@/server/iss-nuvem/executar-lote-nuvem';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const preferredRegion = 'gru1';
export const maxDuration = 300;

export const POST = withErrorHandler(async (req) => {
  requireAgenteIssToken(req);
  agendarLoteNuvemIss();
  return new Response(null, { status: 202 });
});
