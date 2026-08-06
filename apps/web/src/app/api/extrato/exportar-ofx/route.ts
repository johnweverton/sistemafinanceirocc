// GET /api/extrato/exportar-ofx — exporta o extrato de UMA conta/período em arquivo OFX, pra
// importar no sistema contábil do escritório parceiro (Domínio Sistemas aceita OFX nativamente
// no módulo de conciliação bancária — pesquisa em docs/research/2026-08-06-...). Fase 1 da
// exportação financeiro→contábil; lê do NOSSO banco (D1), mesmo dado já exibido em /extrato.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarTransacoes } from '@/server/repositories/extrato-repository';
import { gerarOfx } from '@/server/engine/ofx';
import { CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';

const querySchema = z.object({
  conta: z.enum(CONTAS_EMISSORAS_VALIDAS),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'financeiro']);
  const url = new URL(req.url);
  const query = querySchema.safeParse({
    conta: url.searchParams.get('conta') ?? undefined,
    inicio: url.searchParams.get('inicio') ?? undefined,
    fim: url.searchParams.get('fim') ?? undefined,
  });
  if (!query.success) {
    throw new ApiError(400, 'Informe conta, início e fim (YYYY-MM-DD)', 'VALIDATION', {
      issues: query.error.issues,
    });
  }
  const { conta, inicio, fim } = query.data;

  // Mesmo ajuste de fuso da rota GET /api/extrato (OBS-822): "inicio"/"fim" são o dia em
  // Brasília, não em UTC — sem o offset fixo -03:00, o intervalo vaza a noite anterior/corta
  // o fim do último dia.
  const transacoes = await listarTransacoes({
    contaEmissora: conta,
    dataInicio: `${inicio}T00:00:00.000-03:00`,
    dataFim: `${fim}T23:59:59.999-03:00`,
  });

  const ofx = gerarOfx(
    transacoes.map((t) => ({
      entryId: t.entryId,
      tipo: t.tipo,
      valor: t.valor,
      dataTransacao: t.dataTransacao,
      contraparteNome: t.contraparteNome,
      descricao: t.descricao,
    })),
    { inicio, fim },
    `CORA-${conta.toUpperCase()}`,
  );

  return new Response(ofx, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ofx',
      'Content-Disposition': `attachment; filename="extrato-${conta}-${inicio}-a-${fim}.ofx"`,
    },
  });
});
