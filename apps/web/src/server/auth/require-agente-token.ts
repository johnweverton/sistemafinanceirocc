// Guarda das rotas de máquina do agente ISS (Story 13.1, Épico 13 — decisão D2). O agente roda
// num computador do escritório SEM sessão de usuário e SEM service role: autentica só com um
// bearer token dedicado. A Vercel guarda apenas o SHA-256 dele (AGENTE_ISS_TOKEN_SHA256), então
// nem um vazamento das envs de produção entrega o token. Comparação em tempo constante, mesmo
// espírito do cron (api/cron/relatorio-mensal) e do webhook da Cora. Sem a env → sempre 401
// (fail-closed, nunca "aberta por omissão").
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';

export function requireAgenteIssToken(req: Request): void {
  const esperado = getServerEnv().AGENTE_ISS_TOKEN_SHA256;
  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';

  if (!esperado || !bearer) {
    throw new ApiError(401, 'Token do agente ISS inválido ou não configurado', 'UNAUTHORIZED');
  }

  // Os dois lados viram 32 bytes (digest) — mesmo tamanho sempre, então timingSafeEqual nunca
  // lança nem vaza o tamanho do token pelo tempo de resposta.
  const recebido = createHash('sha256').update(bearer).digest();
  const alvo = Buffer.from(esperado.toLowerCase(), 'hex');
  if (!timingSafeEqual(recebido, alvo)) {
    throw new ApiError(401, 'Token do agente ISS inválido ou não configurado', 'UNAUTHORIZED');
  }
}
