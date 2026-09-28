// POST /api/integracoes/iss/solicitacoes/[id]/progresso — o agente relata "N de total" a cada
// empresa lida (Story 13.5, AC 11); é também o heartbeat. Exige a solicitação `em_andamento`
// (senão 409 — p.ex. o operador cancelou: o agente para). Rota de MÁQUINA (bearer token, D2).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireAgenteIssToken } from '@/server/auth/require-agente-token';
import { registrarProgressoSolicitacaoIss } from '@/server/repositories/iss-solicitacao-repository';
import {
  idSolicitacaoIssSchema,
  progressoSolicitacaoIssSchema,
} from '@/server/validation/iss-solicitacao-schema';

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  requireAgenteIssToken(req);
  const id = idSolicitacaoIssSchema.safeParse(params.id);
  if (!id.success) throw new ApiError(404, 'Solicitação não encontrada', 'NOT_FOUND');
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    throw new ApiError(400, 'Corpo da requisição não é JSON válido', 'BAD_REQUEST');
  }
  const parsed = progressoSolicitacaoIssSchema.safeParse(corpo);
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  return Response.json(await registrarProgressoSolicitacaoIss(id.data, parsed.data));
});
