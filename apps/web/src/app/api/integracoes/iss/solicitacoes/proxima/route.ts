// GET /api/integracoes/iss/solicitacoes/proxima?maquina=NOME — o agente ISS (modo vigiar ou
// agendado) pergunta se há busca a fazer (Story 13.5, AC 10). Rota de MÁQUINA: só o bearer token
// dedicado (D2). Reivindica a `pendente` mais antiga — ou uma `em_andamento` com heartbeat parado
// há mais de 10 min — e a devolve já `em_andamento`. Nada a fazer: 204.
//
// GET que escreve, de propósito: é o "long poll" mais simples que o agente faz a cada 60s, e o
// `force-dynamic` impede qualquer cache no caminho.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireAgenteIssToken } from '@/server/auth/require-agente-token';
import { reivindicarProximaSolicitacaoIss } from '@/server/repositories/iss-solicitacao-repository';
import { reivindicarSolicitacaoIssSchema } from '@/server/validation/iss-solicitacao-schema';
import { buscaIssNaNuvemHabilitada } from '@/server/iss-nuvem/executar-lote-nuvem';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (req) => {
  requireAgenteIssToken(req);
  const parsed = reivindicarSolicitacaoIssSchema.safeParse({
    maquina: new URL(req.url).searchParams.get('maquina'),
  });
  if (!parsed.success) {
    throw new ApiError(422, 'Parâmetro maquina inválido', 'VALIDATION', { issues: parsed.error.issues });
  }
  // Busca pela nuvem ligada (ISS_CPF/ISS_SENHA na Vercel): o agente local não disputa os pedidos.
  if (buscaIssNaNuvemHabilitada()) return new Response(null, { status: 204 });
  const solicitacao = await reivindicarProximaSolicitacaoIss(parsed.data.maquina || null);
  if (!solicitacao) return new Response(null, { status: 204 });
  return Response.json(solicitacao);
});
