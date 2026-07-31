// POST /api/boletos/emitir — emissão de boleto com confirmação manual por médico.
// Regras de negócio (PRD §10):
//   1. Feature flag GATEWAY_EMISSAO_HABILITADA deve estar 'true'.
//   2. Só emite sobre resultado com status 'ok' (nunca alerta/sem_dados).
//   3. Um resultado por vez — sem lote, sem automação.
//   4. Requer confirmação explícita (o médico é o body do request).
//   5. Idempotente: se já existe boleto emitido (ou em processamento — migration 0037), 409.
//
// A lógica de negócio da emissão em si vive em @/server/emissao/emitir-boleto.ts (revisão de
// arquitetura 2026-07-31, decisão 3 — extraída para reuso com o futuro orquestrador de lote).
// Esta rota só cuida do que é específico de HTTP: auth, rate limit, feature flag, parsing do
// body, e tradução do desfecho da emissão para a resposta.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import { requireRole } from '@/server/auth/require-role';
import { emitirBoletoParaResultado } from '@/server/emissao/emitir-boleto';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';

// Emissão encadeia mTLS (token → POST invoice) + download do PDF + disparos WhatsApp/e-mail —
// não cabe nos 10s default do plano Hobby da Vercel (function morta no meio = boleto emitido
// na Cora sem resposta ao navegador).
export const maxDuration = 60;

// Achado I-1: rate limit — máximo 10 emissões por minuto por usuário.
const emitirLimiter = createRateLimiter('boletos-emitir', { limit: 10, windowMs: 60_000 });

const bodySchema = z.object({
  execucaoResultadoId: z.string().uuid(),
});

export const POST = withErrorHandler(async (req) => {
  // 1. Auth: somente admin ou financeiro.
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(emitirLimiter, sessao.userId, 'emissão de boleto');

  // 2. Feature flag: bloqueia se desligada.
  const env = getServerEnv();
  if (env.GATEWAY_EMISSAO_HABILITADA !== 'true') {
    throw new ApiError(
      403,
      'Emissão de boletos desabilitada. A feature flag GATEWAY_EMISSAO_HABILITADA está desligada. ' +
        'Ligue somente após validação em produção (PRD §10).',
      'EMISSAO_DESABILITADA',
    );
  }

  // 3. Validar body.
  const body = bodySchema.parse(await req.json());

  // 4-10. Lógica de negócio compartilhada (validações, idempotência, emissão, disparo).
  const resultado = await emitirBoletoParaResultado({
    execucaoResultadoId: body.execucaoResultadoId,
    emitidoPor: sessao.userId,
  });

  if (resultado.tipo === 'ja_emitido') {
    return NextResponse.json(
      {
        error: {
          code: 'BOLETO_JA_EMITIDO',
          message: 'Já existe boleto emitido para este resultado.',
          boletoId: resultado.boletoId,
        },
      },
      { status: 409 },
    );
  }

  const httpStatus = resultado.tipo === 'emitido' ? 201 : 502;
  return NextResponse.json({ boleto: resultado.boleto }, { status: httpStatus });
});
