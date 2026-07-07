// POST /api/execucoes/[id]/resultados/[resultadoId]/revisar — revisão manual de um resultado
// em 'alerta', liberando-o para 'ok' (única forma de sair desse estado hoje — architecture gap
// identificado 2026-07-08: 'alerta' não tinha nenhum caminho de revisão em nenhuma camada).
// Mesma trava de permissão de quem emite boleto (admin/financeiro): quem confirma a anomalia é do
// mesmo nível de quem assume o risco financeiro da emissão seguinte.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { revisarResultado } from '@/server/repositories/execucao-repository';

const bodySchema = z.object({
  motivo: z.string().trim().min(5, 'Motivo obrigatório (mínimo 5 caracteres)'),
});

export const POST = withErrorHandler<{ id: string; resultadoId: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Payload inválido', 'VALIDATION', { issues: parsed.error.issues });
  }

  const resultado = await revisarResultado(params.resultadoId, sessao.userId, parsed.data.motivo);
  return Response.json({ resultado });
});
