// GET /api/execucoes/medicos-com-boleto?competencia=AAAA-MM — ids dos médicos que já têm
// boleto ativo (emitido/pago) nessa competência, em QUALQUER execução (achado real 2026-08-04,
// ver boleto-repository.ts). A UI de nova execução usa isso pra excluir/avisar sobre médicos
// já cobertos, tanto no modo "por médico" quanto "por competência" (lote) — sem isso, nada
// impede reemitir boleto duplicado do mesmo médico no mesmo mês numa execução nova.
//
// SEM CACHE de propósito (diferente de /api/execucoes/apoio, que cacheia 5min): precisa
// refletir uma emissão feita há poucos segundos, senão o próprio objetivo da checagem falha.
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarMedicosComBoletoAtivo } from '@/server/repositories/boleto-repository';

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
  const medicoIds = await listarMedicosComBoletoAtivo(query.data.competencia);
  return Response.json({ medicoIds: [...medicoIds] });
});
