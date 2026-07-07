// GET /api/execucoes/[id]/resultados — relatório completo (PRD §8.4).
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { listarResultados } from '@/server/repositories/execucao-repository';
import { listarDisparosPorExecucao } from '@/server/repositories/boleto-disparo-repository';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'colaborador', 'financeiro']);
  const resultados = await listarResultados(params.id);
  
  // Anexar histórico de disparos de boleto para cada resultado
  const disparosMap = await listarDisparosPorExecucao(params.id);
  for (const r of resultados) {
    const list = disparosMap[r.id];
    if (list) {
      r.disparos = list.map(d => ({
        canal: d.canal,
        status: d.status,
        mensagemErro: d.mensagem_erro,
        enviadoEm: d.enviado_em,
      }));
    } else {
      r.disparos = [];
    }
  }

  return Response.json(resultados);
});
