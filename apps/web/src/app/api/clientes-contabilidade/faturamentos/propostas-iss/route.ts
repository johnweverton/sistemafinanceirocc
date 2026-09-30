// GET /api/clientes-contabilidade/faturamentos/propostas-iss?competencia=AAAA-MM — o que o agente
// do ISS Fortaleza leu para a competência, pronto para o LoteContabilidadeDialog pré-preencher o
// faturamento (Story 13.3, Épico 13). Devolve, junto, o que já foi LANÇADO com valor: é a
// comparação da regra R4 (proposta ≠ lançado ⇒ divergência, nunca sobrescrita silenciosa).
//
// Autenticação por SESSÃO (operador), como as demais rotas do diálogo — o token do agente só vale
// em /api/integracoes/iss/*. Leitura pura: nada aqui grava em clientes_contabilidade_faturamentos
// (decisão G3). SEM CACHE, mesmo motivo de lancados/route.ts: a tela precisa refletir o que o
// operador acabou de lançar e o que o agente acabou de enviar.
import { z } from 'zod';
import type { PropostasIssResposta } from '@cobranca/shared';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import {
  buscarUltimaExecucaoIss,
  listarPropostasIssVigentes,
} from '@/server/repositories/iss-captura-repository';
import { listarFaturamentosDaCompetencia } from '@/server/repositories/cliente-contabilidade-faturamento-repository';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM'),
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
  const { competencia } = query.data;
  const [propostas, ultimaExecucao, lancados] = await Promise.all([
    listarPropostasIssVigentes(competencia),
    buscarUltimaExecucaoIss(competencia),
    listarFaturamentosDaCompetencia(competencia),
  ]);
  const corpo: PropostasIssResposta = { competencia, propostas, ultimaExecucao, lancados };
  return Response.json(corpo);
});
