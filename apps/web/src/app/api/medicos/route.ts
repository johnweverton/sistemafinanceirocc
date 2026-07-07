// GET /api/medicos — lista (filtrável). POST /api/medicos — cria (admin).
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarMedicos, criarMedico } from '@/server/repositories/medico-repository';
import { novoMedicoSchema } from '@/server/validation/medico-schema';

// Achado B-3: validar query params com Zod (consistência com validação de bodies).
const listarMedicosQuerySchema = z.object({
  colaborador: z.string().optional(),
  ativo: z.enum(['true', 'false']).optional(),
});

export const GET = withErrorHandler(async (req) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const url = new URL(req.url);
  const query = listarMedicosQuerySchema.safeParse({
    colaborador: url.searchParams.get('colaborador') ?? undefined,
    ativo: url.searchParams.get('ativo') ?? undefined,
  });
  if (!query.success) {
    throw new ApiError(400, 'Parâmetros de consulta inválidos', 'VALIDATION', { issues: query.error.issues });
  }
  const medicos = await listarMedicos({
    colaboradorResponsavel: query.data.colaborador,
    ativo: query.data.ativo == null ? undefined : query.data.ativo === 'true',
  });
  return Response.json(medicos);
});

export const POST = withErrorHandler(async (req) => {
  await requireRole(['admin']);
  const parsed = novoMedicoSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(422, 'Dados inválidos', 'VALIDATION', { issues: parsed.error.issues });
  }
  const medico = await criarMedico(parsed.data);
  return Response.json(medico, { status: 201 });
});
