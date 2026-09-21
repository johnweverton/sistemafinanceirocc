// POST /api/integracoes/iss/execucoes — o agente ISS entrega uma rodada inteira: capturas de
// faturamento + comunicados em que deu ciência (Story 13.1, Épico 13). Rota de MÁQUINA: sem
// sessão, só o bearer token dedicado (D2). Grava PROPOSTAS — nunca o lançamento oficial (G3).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireAgenteIssToken } from '@/server/auth/require-agente-token';
import { registrarExecucaoIss } from '@/server/repositories/iss-captura-repository';
import { novaExecucaoIssSchema } from '@/server/validation/agente-iss-schema';

export const POST = withErrorHandler(async (req) => {
  requireAgenteIssToken(req);
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    throw new ApiError(400, 'Corpo da requisição não é JSON válido', 'BAD_REQUEST');
  }
  const parsed = novaExecucaoIssSchema.safeParse(corpo);
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const registrada = await registrarExecucaoIss(parsed.data);
  return Response.json(registrada, { status: 201 });
});
