// GET /api/relatorios/publico/[token] — BI público de Relatórios (link com token, sem login).
// NUNCA usa vw_recebiveis: lê só das views agregadas de dashboard (resumoPorCompetencia/
// resumoPorEmpresa/aging), que nunca carregam nome de médico, boletoId ou id_externo Cora — a
// privacidade do link público vem da própria fonte de dado, não de um filtro aplicado aqui.
// Sem requireRole/withErrorHandler: token inexistente/revogado/expirado devolve 404 uniforme em
// texto puro (não revela o motivo), sem o envelope JSON das rotas autenticadas.
import { NextResponse } from 'next/server';
import { buscarLinkValidoPorToken, registrarAcesso } from '@/server/repositories/relatorio-links-repository';
import { resumoPorCompetencia, resumoPorEmpresa, aging } from '@/server/repositories/dashboard-repository';
import { logAuthFailure, extractIp } from '@/lib/security-logger';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import type { RelatorioPublicoResposta, KpiRelatorioPublico } from '@cobranca/shared';

function kpiZerado(competencia: string | null): KpiRelatorioPublico {
  return { competencia, qtdBoletos: 0, totalEmitido: 0, totalRecebido: 0, totalEmAberto: 0, totalVencido: 0, taxaInadimplencia: 0 };
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const link = await buscarLinkValidoPorToken(params.token);
  if (!link) {
    logAuthFailure(req, 'Token de relatório público inválido, revogado ou expirado');
    return new NextResponse('Not Found', { status: 404 });
  }

  const url = new URL(req.url);
  const competenciaParam = url.searchParams.get('competencia');
  const competencia = competenciaParam && /^\d{4}-\d{2}$/.test(competenciaParam) ? competenciaParam : undefined;
  const escopo = link.escopoContaEmissora ?? undefined;

  // Uma query só: vw_dashboard_competencia já devolve TODAS as competências + a linha de
  // rollup (competencia null) quando nenhum filtro de competência é passado.
  const todasCompetencias = await resumoPorCompetencia(undefined, escopo);
  const porCompetencia = todasCompetencias.filter((r) => r.competencia !== null);
  const rollup = todasCompetencias.find((r) => r.competencia === null) ?? kpiZerado(null);
  const kpiSelecionado = competencia
    ? (porCompetencia.find((r) => r.competencia === competencia) ?? kpiZerado(competencia))
    : rollup;

  const [porEmpresaRows, agingFaixas] = await Promise.all([
    resumoPorEmpresa(competencia, escopo),
    aging(competencia, escopo),
  ]);

  const resposta: RelatorioPublicoResposta = {
    nomeLink: link.nome,
    escopoContaEmissora: link.escopoContaEmissora,
    competenciasDisponiveis: porCompetencia.map((r) => r.competencia!).sort((a, b) => (a < b ? 1 : -1)),
    kpi: kpiSelecionado,
    evolucaoMensal: [...porCompetencia].sort((a, b) => (a.competencia! < b.competencia! ? -1 : 1)),
    porEmpresa: porEmpresaRows.map((r) => ({
      contaEmissora: r.contaEmissora,
      contaEmissoraLabel: CONTA_EMISSORA_LABEL[r.contaEmissora],
      totalEmitido: r.totalEmitido,
      totalRecebido: r.totalRecebido,
      totalEmAberto: r.totalEmAberto,
      totalVencido: r.totalVencido,
    })),
    aging: agingFaixas.map((a) => ({ faixa: a.faixa, qtd: a.qtd, total: a.total })),
    geradoEm: new Date().toISOString(),
  };

  void registrarAcesso(link.id, extractIp(req));

  return NextResponse.json(resposta);
}
