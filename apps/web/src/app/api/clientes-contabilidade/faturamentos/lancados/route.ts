// GET /api/clientes-contabilidade/faturamentos/lancados?competencia=AAAA-MM — ids dos clientes
// contábeis que já têm faturamento lançado nessa competência. Espelho estrutural da rota
// /api/clientes-contabilidade/com-boleto (Story 12.3): a mesma forma de resposta, o mesmo
// chaveamento por competência e o mesmo motivo para existir — o LoteContabilidadeDialog precisa
// dizer a verdade ANTES do clique.
//
// Story 12.5 (G-12): sem isto o painel de composição teria que inferir "lançado vs pendente" do
// estado do próprio diálogo, o que estaria errado sempre que o faturamento tivesse sido lançado
// numa sessão anterior, por outro operador ou pela emissão individual.
//
// SEM CACHE de propósito, mesmo motivo de com-boleto/route.ts: o operador acabou de lançar
// faturamento no passo 1 e precisa ver a contagem mudar.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarClientesContabilidadeComFaturamentoLancado } from '@/server/repositories/cliente-contabilidade-faturamento-repository';

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
  const clienteContabilidadeIds = await listarClientesContabilidadeComFaturamentoLancado(
    query.data.competencia,
  );
  return Response.json({ clienteContabilidadeIds });
});
