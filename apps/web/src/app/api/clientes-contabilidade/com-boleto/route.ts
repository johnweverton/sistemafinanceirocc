// GET /api/clientes-contabilidade/com-boleto?competencia=AAAA-MM — ids dos clientes contábeis
// que já têm boleto ativo (emitido/pago) nessa competência, em QUALQUER execução. Espelho da
// rota /api/execucoes/medicos-com-boleto (Story 12.3, risco RS-1): o cálculo em lote de clientes
// contábeis cria uma execução nova a cada disparo, então rodar o mesmo lote/competência duas
// vezes gerava um segundo boleto ativo pro mesmo cliente. O LoteContabilidadeDialog usa esta
// lista pra remover do payload quem já está coberto — bloqueio duro, sem opt-in.
//
// SEM CACHE de propósito (mesmo motivo documentado em medicos-com-boleto/route.ts): precisa
// refletir uma emissão feita há poucos segundos, senão o próprio objetivo da checagem falha.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarClientesContabilidadeComBoletoAtivo } from '@/server/repositories/boleto-repository';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Formato esperado: AAAA-MM'),
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
  const clienteContabilidadeIds = await listarClientesContabilidadeComBoletoAtivo(query.data.competencia);
  return Response.json({ clienteContabilidadeIds: [...clienteContabilidadeIds] });
});
