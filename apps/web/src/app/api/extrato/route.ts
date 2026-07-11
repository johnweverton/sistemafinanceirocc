// GET /api/extrato — lista o snapshot do extrato (admin/financeiro) com filtros por
// querystring e totais do período (Story 8.2, AC 3). Lê do NOSSO banco (D1) — nenhuma
// chamada à Cora acontece aqui; sincronizar é ação explícita (POST /api/extrato/sincronizar).
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarTransacoes } from '@/server/repositories/extrato-repository';
import { listarRecebiveisPorBoletoIds } from '@/server/repositories/recebiveis-repository';
import { CONTAS_EMISSORAS_VALIDAS, STATUS_CONCILIACAO_VALIDOS } from '@cobranca/shared';
import type { ExtratoTransacaoComBoleto, FiltroListagemExtrato } from '@cobranca/shared';

// Whitelists via Zod (mesmo padrão da rota de recebíveis) — enums espelham as CHECKs do banco.
const extratoQuerySchema = z.object({
  conta: z.enum(CONTAS_EMISSORAS_VALIDAS).optional(),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD').optional(),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD').optional(),
  status: z.enum(STATUS_CONCILIACAO_VALIDOS).optional(),
  tipo: z.enum(['CREDIT', 'DEBIT']).optional(),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const query = extratoQuerySchema.safeParse({
    conta: url.searchParams.get('conta') ?? undefined,
    inicio: url.searchParams.get('inicio') ?? undefined,
    fim: url.searchParams.get('fim') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    tipo: url.searchParams.get('tipo') ?? undefined,
  });
  if (!query.success) {
    throw new ApiError(400, 'Parâmetros de consulta inválidos', 'VALIDATION', {
      issues: query.error.issues,
    });
  }

  // data_transacao é timestamptz — "inicio"/"fim" chegam como data pura (YYYY-MM-DD) e
  // representam o dia em Brasília, não em UTC. Offset fixo -03:00 (Brasil não tem mais
  // horário de verão desde 2019): sem ele, o intervalo abre 3h cedo e fecha 3h cedo,
  // vazando a noite anterior para dentro e cortando o fim da noite do último dia (OBS-822).
  const filtros: FiltroListagemExtrato = {
    contaEmissora: query.data.conta,
    dataInicio: query.data.inicio ? `${query.data.inicio}T00:00:00.000-03:00` : undefined,
    dataFim: query.data.fim ? `${query.data.fim}T23:59:59.999-03:00` : undefined,
    status: query.data.status,
    tipo: query.data.tipo,
  };

  const transacoes = await listarTransacoes(filtros);

  // Embute o resumo do boleto vinculado/candidato (Story 8.3): a fila de sugestões mostra
  // transação × boleto lado a lado sem N+1 no cliente. Uma query para todos os ids.
  const boletoIds = [...new Set(transacoes.map((t) => t.boletoId).filter((id): id is string => !!id))];
  const recebiveis = await listarRecebiveisPorBoletoIds(boletoIds);
  const porBoleto = new Map(recebiveis.map((r) => [r.boletoId, r]));
  const comBoleto: ExtratoTransacaoComBoleto[] = transacoes.map((t) => ({
    ...t,
    boletoVinculado: t.boletoId ? (porBoleto.get(t.boletoId) ?? null) : null,
  }));

  // Totais do período para o card da 8.3 (volume v1 é pequeno — soma em memória).
  // Tarifas são um recorte dos débitos (transaction_type FEE), não uma terceira categoria.
  const totais = transacoes.reduce(
    (acc, t) => {
      if (t.tipo === 'CREDIT') acc.creditos += t.valor;
      else {
        acc.debitos += t.valor;
        if (t.transactionType === 'FEE') acc.tarifas += t.valor;
      }
      return acc;
    },
    { creditos: 0, debitos: 0, tarifas: 0 },
  );

  return Response.json({ transacoes: comBoleto, totais });
});
