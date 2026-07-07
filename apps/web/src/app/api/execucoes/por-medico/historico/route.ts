// GET /api/execucoes/por-medico/historico?medicoId=|cpf= — drill-down lazy da visão "Por médico":
// todas as ocorrências de um médico específico ao longo das competências.
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { historicoResultadosPorMedico } from '@/server/repositories/execucao-repository';

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const url = new URL(req.url);
  const medicoId = url.searchParams.get('medicoId');
  const cpf = url.searchParams.get('cpf');

  if (!medicoId && !cpf) {
    throw new ApiError(422, 'Informe medicoId ou cpf', 'VALIDATION');
  }

  const historico = await historicoResultadosPorMedico(medicoId ? { medicoId } : { cpf: cpf! });
  return Response.json(historico);
});
