// GET /api/integracoes/iss/alvos?competencia=AAAA-MM — lista de clientes que o agente ISS deve
// buscar no portal (Story 13.1, Épico 13). Rota de MÁQUINA: sem sessão, só o bearer token
// dedicado (D2). Devolve o mínimo para localizar a empresa no portal (id, nome, documento).
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireAgenteIssToken } from '@/server/auth/require-agente-token';
import { listarAlvosIss } from '@/server/repositories/iss-captura-repository';
import { competenciaIssSchema } from '@/server/validation/agente-iss-schema';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (req) => {
  requireAgenteIssToken(req);
  const parsed = competenciaIssSchema.safeParse(new URL(req.url).searchParams.get('competencia'));
  if (!parsed.success) {
    throw new ApiError(422, 'Competência inválida (use AAAA-MM)', 'VALIDATION', {
      issues: parsed.error.issues,
    });
  }
  return Response.json(await listarAlvosIss(parsed.data));
});
