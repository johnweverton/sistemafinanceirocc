// POST /api/integracoes/iss/solicitacoes/[id]/concluir — o agente encerra a solicitação (Story
// 13.5, AC 12): `{ execucaoId }` (a execução já registrada em POST /execucoes) ⇒ `concluida`;
// `{ erro }` (senha recusada, portal fora, qualquer coisa que impediu a execução) ⇒ `falhou`.
// Exige `em_andamento` (senão 409). É o ÚNICO lugar que fecha a máquina de estados — o
// `solicitacaoId` de POST /execucoes é só guarda. Rota de MÁQUINA (bearer token, D2).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireAgenteIssToken } from '@/server/auth/require-agente-token';
import { concluirSolicitacaoIss } from '@/server/repositories/iss-solicitacao-repository';
import {
  conclusaoSolicitacaoIssSchema,
  idSolicitacaoIssSchema,
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
  const parsed = conclusaoSolicitacaoIssSchema.safeParse(corpo);
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos (envie { execucaoId } ou { erro })', 'VALIDATION', {
      issues: parsed.error.issues,
    });
  }
  return Response.json(await concluirSolicitacaoIss(id.data, parsed.data));
});
