// /api/clientes-contabilidade/faturamentos/iss-solicitacoes — o operador pede ao agente do ISS
// que busque o faturamento da competência (Story 13.5, Épico 13 — Fase 2).
//
//   POST { competencia, documentos? } → cria a solicitação `pendente` (201) ou, se já existe uma
//        ativa na competência, devolve ELA (200) — idempotente; a barreira real é o índice único
//        parcial da migration 0062.
//   GET  ?competencia=AAAA-MM          → a ativa, senão a mais recente, senão `null`.
//
// Sessão de OPERADOR, mesma guarda de propostas-iss/route.ts — o token do agente só vale em
// /api/integracoes/iss/*.
//
// Busca pela NUVEM (server/iss-nuvem): com ISS_CPF/ISS_SENHA na Vercel, criar a solicitação já
// dispara o primeiro lote, e o GET (polling de 5 s da tela) dispara o próximo se o lote anterior
// foi liberado ou parou de dar sinal de vida — rede de segurança do encadeamento entre lotes.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  buscarSolicitacaoIssDaCompetencia,
  criarSolicitacaoIss,
} from '@/server/repositories/iss-solicitacao-repository';
import { novaSolicitacaoIssSchema } from '@/server/validation/iss-solicitacao-schema';
import { agendarLoteNuvemIss } from '@/server/iss-nuvem/executar-lote-nuvem';
import { loteNuvemDisponivel } from '@/server/repositories/iss-solicitacao-repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const preferredRegion = 'gru1';
export const maxDuration = 300;

const querySchema = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM'),
});

export const POST = withErrorHandler(async (req) => {
  const sessao = await requireRole(['admin', 'colaborador', 'financeiro']);
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    throw new ApiError(400, 'Corpo da requisição não é JSON válido', 'BAD_REQUEST');
  }
  const parsed = novaSolicitacaoIssSchema.safeParse(corpo);
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const { solicitacao, criada } = await criarSolicitacaoIss({
    competencia: parsed.data.competencia,
    documentos: parsed.data.documentos ?? null,
    solicitadoPor: sessao.userId,
  });
  agendarLoteNuvemIss();
  return Response.json(solicitacao, { status: criada ? 201 : 200 });
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const url = new URL(req.url);
  const query = querySchema.safeParse({ competencia: url.searchParams.get('competencia') ?? undefined });
  if (!query.success) {
    throw new ApiError(400, 'Parâmetro competencia (AAAA-MM) é obrigatório', 'VALIDATION', {
      issues: query.error.issues,
    });
  }
  const solicitacao = await buscarSolicitacaoIssDaCompetencia(query.data.competencia);
  if (solicitacao && loteNuvemDisponivel(solicitacao)) agendarLoteNuvemIss();
  return Response.json(solicitacao);
});
