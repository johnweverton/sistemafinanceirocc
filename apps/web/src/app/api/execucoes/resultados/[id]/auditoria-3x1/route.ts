// GET /api/execucoes/resultados/[id]/auditoria-3x1 — exporta a planilha de auditoria visual da
// regra 3x1 (achado 2026-09-04, Dra. Emilie: contagem manual deu 59, sistema deu 69, segunda
// conferência manual deu 61). Mesma auth de recalcular/route.ts, mas SEM a trava de boleto
// emitido — o caso real é auditar um resultado possivelmente já emitido. Só LÊ os itens da
// origem ATUAL pra montar a planilha; nunca roda `processarMedico` nem grava nada.
import { withErrorHandler } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { buscarItensDoResultado } from '@/server/orchestrator/recalculo-resultado';
import { montarLinhasAuditoria, gerarAuditoria3x1Excel } from '@/server/engine/auditoria-3x1-excel';

export const GET = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'financeiro']);

  const dados = await buscarItensDoResultado(params.id);

  const linhasAuditoria = montarLinhasAuditoria(
    {
      lotePrincipal: dados.lotePrincipal,
      outrosHospitais: dados.outrosHospitais,
      imobilizacoes: dados.imobilizacoes,
      angiografia: dados.angiografia,
      cateter: dados.cateter,
      fistula: dados.fistula,
    },
    dados.medico.especialidade,
  );

  const buffer = await gerarAuditoria3x1Excel(linhasAuditoria, {
    medicoNome: dados.medico.nome,
    competencia: dados.execucao.competencia,
    guiasResultado: dados.resultado.guias ?? 0,
    guiasAcumuladasAntes: dados.saldoAcumulado?.guiasPrincipal,
    guiasManuaisMotivo: dados.guiasManuaisMotivo,
  });

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="auditoria-3x1-${dados.medico.nome.replace(/[^\w-]+/g, '_')}-${dados.execucao.competencia}.xlsx"`,
    },
  });
});
