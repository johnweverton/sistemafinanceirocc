// POST /api/execucoes/resultados/[id]/usar-consolidado — atalho "usar consolidado" (achado
// 2026-09-04, feedback do dono ao ver "92 guias cobradas · consolidado (ignora a data no
// agrupamento) 65 — diverge por atendimento em mais de 1 dia"): aceita o valor CONSOLIDADO já
// calculado como o novo total do lote PRINCIPAL, sem precisar preparar planilha. Mesma trava de
// permissão de quem recalcula/emite boleto.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { usarConsolidadoNoResultado } from '@/server/orchestrator/recalculo-resultado';

const bodySchema = z.object({
  motivo: z.string().trim().min(5, 'Motivo obrigatório (mínimo 5 caracteres)'),
});

export const POST = withErrorHandler<{ id: string }>(async (req, { params }) => {
  const sessao = await requireRole(['admin', 'financeiro']);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Payload inválido', 'VALIDATION', { issues: parsed.error.issues });
  }

  const resultado = await usarConsolidadoNoResultado(params.id, parsed.data.motivo, sessao.userId);
  return Response.json({ resultado });
});
