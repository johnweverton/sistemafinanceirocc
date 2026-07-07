// GET /api/execucoes/por-medico — visão "Por médico": 1 linha por médico com a ocorrência mais
// recente e a contagem total (migration 0013, view vw_execucoes_resumo_medico).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarResumoPorMedico } from '@/server/repositories/execucao-repository';

export const GET = withErrorHandler(async () => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const resumo = await listarResumoPorMedico();
  return Response.json(resumo);
});
