'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContaEmissora, TipoServico } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL, CONTAS_EMISSORAS_VALIDAS, TIPO_SERVICO_LABEL, TIPOS_SERVICO_VALIDOS } from '@cobranca/shared';
import { dashboardService, dashboardQueryKeys } from '@/services/dashboard';
import { recebiveisService, recebiveisQueryKeys } from '@/services/recebiveis';
import { agruparInadimplentesPorMedico } from '@/lib/inadimplencia';
import { SaldoEmpresas } from '@/components/dashboard/SaldoEmpresas';
import { EvolucaoMensalChart } from '@/components/dashboard/EvolucaoMensalChart';
import { VencidoPorMedicoChart } from '@/components/dashboard/VencidoPorMedicoChart';
import { InadimplenciaSection } from '@/components/dashboard/InadimplenciaSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { brl } from '@/lib/formato';

function pct(v: number): string {
  return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function DashboardManager() {
  const [competencia, setCompetencia] = useState<string>('');
  const filtro = competencia || undefined; // undefined = "Todas" (linha de rollup no banco)
  const [contaEmissora, setContaEmissora] = useState<ContaEmissora | ''>('');
  const contaFiltro = contaEmissora || undefined; // undefined = "Todas as contas" (linha de rollup no banco)
  // Cobrança Médica vs Contabilidade (migration 0050, feedback do dono 2026-08-19) — NÃO é a
  // mesma dimensão que contaEmissora (as 4 contas atendem qualquer tipo de serviço desde a 0040).
  const [tipoServico, setTipoServico] = useState<TipoServico | ''>('');
  const tipoFiltro = tipoServico || undefined;
  // Com tipoServico='contabilidade' selecionado, "Por médico"/"Quem está inadimplente" passam a
  // listar clientes contábeis (medico_id NULL, nome = nome do cliente — mesmo desenho de sempre,
  // ver vw_dashboard_medico). Rótulo muda pra refletir isso, sem view nem seção nova.
  const rotuloPessoa = tipoServico === 'contabilidade' ? 'Cliente' : 'Médico';

  // A view retorna as linhas por competência + a linha de rollup (competencia = null = total geral).
  const comps = useQuery({
    queryKey: dashboardQueryKeys.competencias(contaFiltro, tipoFiltro),
    queryFn: () => dashboardService.competencias(undefined, contaFiltro, tipoFiltro),
  });
  const medicos = useQuery({
    queryKey: dashboardQueryKeys.medicos(filtro, contaFiltro, tipoFiltro),
    queryFn: () => dashboardService.medicos(filtro, contaFiltro, tipoFiltro),
  });
  const agingQ = useQuery({
    queryKey: dashboardQueryKeys.aging(filtro, contaFiltro, tipoFiltro),
    queryFn: () => dashboardService.aging(filtro, contaFiltro, tipoFiltro),
  });
  // Resumo Cobrança Médica × Contabilidade — sempre as 2 linhas, independente do filtro acima
  // (é o próprio seletor de "separar as emissões" pedido pelo dono).
  const porTipoServicoQ = useQuery({
    queryKey: dashboardQueryKeys.tipoServico(filtro),
    queryFn: () => dashboardService.tipoServico(filtro),
  });
  // Inadimplência (BI gerencial, feedback da CEO 2026-08-17): reusa o MESMO endpoint/serviço já
  // usado por /recebiveis (Contas a Receber) — sem view/rota nova, só filtra status=vencido e
  // agrupa por médico no cliente (agruparInadimplentesPorMedico, lib/inadimplencia.ts).
  const vencidosQ = useQuery({
    queryKey: recebiveisQueryKeys.recebiveis({ competencia: filtro, statusDerivado: 'vencido', contaEmissora: contaFiltro, tipoServico: tipoFiltro }),
    queryFn: () => recebiveisService.listar({ competencia: filtro, statusDerivado: 'vencido', contaEmissora: contaFiltro, tipoServico: tipoFiltro }),
  });
  // Lembrete de vencimento (Épico 13, Fase 1) — indicador de auditoria pedido pela CEO para
  // confirmar que os lembretes automáticos estão saindo, sem precisar cobrar a equipe. Independe
  // dos filtros acima (competência/conta/tipo de serviço) — é sempre "o mês corrente todo".
  const lembretesQ = useQuery({
    queryKey: dashboardQueryKeys.lembretesVencimento(),
    queryFn: () => dashboardService.lembretesVencimento(),
  });

  const linhas = useMemo(() => comps.data ?? [], [comps.data]);
  // Opções do seletor: só competências reais (exclui a linha de rollup).
  const competencias = useMemo(() => linhas.filter((c) => c.competencia !== null), [linhas]);
  const inadimplentes = useMemo(() => agruparInadimplentesPorMedico(vencidosQ.data ?? []), [vencidosQ.data]);

  // KPI da competência selecionada, ou a linha de rollup (competencia = null) para "Todas".
  // A taxa de inadimplência vem PRONTA do banco — sem recomputo no cliente.
  const kpi = useMemo(() => {
    if (competencia) return linhas.find((c) => c.competencia === competencia) ?? null;
    return linhas.find((c) => c.competencia === null) ?? null;
  }, [linhas, competencia]);

  const agingMax = Math.max(1, ...(agingQ.data ?? []).map((a) => a.total));
  const escopo = competencia ? `competência ${competencia}` : 'todas as competências';

  if (comps.isLoading) {
    return (
      <section className="space-y-5">
        <div className="page-header"><h1 className="page-title">Dashboard financeiro</h1></div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </section>
    );
  }

  if (competencias.length === 0) {
    return (
      <section className="space-y-5">
        <div className="page-header"><h1 className="page-title">Dashboard financeiro</h1></div>
        {/* Saldo independe de boletos emitidos. */}
        <SaldoEmpresas />
        <EmptyState title="Sem dados financeiros ainda" description="Emita boletos para ver os indicadores por competência, médico e inadimplência." />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Dashboard financeiro</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select value={competencia} onChange={(e) => setCompetencia(e.target.value)} className="input w-44">
            <option value="">Todas as competências</option>
            {competencias.map((c) => (
              <option key={c.competencia} value={c.competencia ?? ''}>{c.competencia}</option>
            ))}
          </select>
          <select
            value={contaEmissora}
            onChange={(e) => setContaEmissora(e.target.value as ContaEmissora | '')}
            className="input w-44"
            aria-label="Filtrar por conta emissora"
          >
            <option value="">Todas as contas</option>
            {CONTAS_EMISSORAS_VALIDAS.map((c) => (
              <option key={c} value={c}>{CONTA_EMISSORA_LABEL[c]}</option>
            ))}
          </select>
          <select
            value={tipoServico}
            onChange={(e) => setTipoServico(e.target.value as TipoServico | '')}
            className="input w-44"
            aria-label="Filtrar por tipo de serviço"
          >
            <option value="">Todos os serviços</option>
            {TIPOS_SERVICO_VALIDOS.map((t) => (
              <option key={t} value={t}>{TIPO_SERVICO_LABEL[t]}</option>
            ))}
          </select>
        </div>
      </div>

      <SaldoEmpresas />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Kpi label="Emitido" valor={brl(kpi?.totalEmitido ?? 0)} />
        <Kpi label="Recebido" valor={brl(kpi?.totalRecebido ?? 0)} tom="success" />
        <Kpi label="Em aberto" valor={brl(kpi?.totalEmAberto ?? 0)} />
        <Kpi label="Vencido" valor={brl(kpi?.totalVencido ?? 0)} tom="warning" />
        <Kpi label="Inadimplência" valor={pct(kpi?.taxaInadimplencia ?? 0)} tom={(kpi?.taxaInadimplencia ?? 0) > 0.2 ? 'danger' : 'default'} />
      </div>

      {/* Indicadores operacionais (separados dos valores em R$ acima) — Épico 13: visibilidade
          de que o lembrete automático de vencimento está de fato saindo. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Kpi label="Lembretes enviados (mês)" valor={String(lembretesQ.data?.enviadosNoMes ?? 0)} />
      </div>

      {/* Cobrança Médica × Contabilidade — feedback do dono 2026-08-19: "separar as emissões". */}
      {!tipoServico && (porTipoServicoQ.data ?? []).length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(porTipoServicoQ.data ?? []).map((r) => (
            <button
              key={r.tipoServico}
              type="button"
              onClick={() => setTipoServico(r.tipoServico)}
              className="card flex items-center justify-between p-4 text-left transition-colors hover:border-cc-accent"
              title={`Ver só ${TIPO_SERVICO_LABEL[r.tipoServico]}`}
            >
              <div>
                <p className="font-mono text-2xs uppercase tracking-wider text-cc-muted">{TIPO_SERVICO_LABEL[r.tipoServico]}</p>
                <p className="tabular mt-1 text-lg font-semibold text-cc-ink">{brl(r.totalEmitido)}</p>
              </div>
              <div className="text-right text-2xs text-cc-muted">
                <p>Recebido <span className="text-cc-success">{brl(r.totalRecebido)}</span></p>
                <p>Vencido <span className="text-cc-warning">{brl(r.totalVencido)}</span></p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Evolução mensal — visão de tendência que os KPIs (foto de UMA competência) não davam. */}
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-cc-ink">Evolução mensal</h2>
        <EvolucaoMensalChart dados={competencias} />
      </div>

      {/* Aging */}
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-cc-ink">Aging de vencidos <span className="font-normal text-cc-muted">· {escopo}</span></h2>
        {(agingQ.data ?? []).length === 0 ? (
          <p className="text-sm text-cc-muted">Nenhum boleto vencido.</p>
        ) : (
          <div className="space-y-2">
            {(agingQ.data ?? []).map((a) => (
              <div key={a.faixa} className="flex items-center gap-3">
                <span className="w-16 font-mono text-2xs text-cc-muted">{a.faixa} dias</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-cc-surface-2">
                  <div className="progress-fill h-full rounded-full" style={{ width: `${(a.total / agingMax) * 100}%` }} />
                </div>
                <span className="tabular w-28 text-right text-sm text-cc-ink">{brl(a.total)}</span>
                <span className="w-10 text-right text-2xs text-cc-muted">{a.qtd}x</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quem está inadimplente — BI gerencial (feedback da CEO, 2026-08-17): cards por médico
          com drill-down pros boletos vencidos individuais, mais o gráfico de "quem deve mais". */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-cc-ink">Quem está inadimplente <span className="font-normal text-cc-muted">· {escopo}</span></h2>
        <div className="card p-5">
          {vencidosQ.isLoading ? <Skeleton className="h-40" /> : <VencidoPorMedicoChart dados={inadimplentes} />}
        </div>
        {vencidosQ.isLoading ? <Skeleton className="h-40" /> : <InadimplenciaSection inadimplentes={inadimplentes} vencidos={vencidosQ.data ?? []} />}
      </div>

      {/* Por médico / cliente contábil, conforme o filtro de tipo de serviço acima. */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-cc-ink">Por {rotuloPessoa.toLowerCase()} <span className="font-normal text-cc-muted">· {escopo}</span></h2>
        {medicos.isLoading ? (
          <Skeleton className="h-40" />
        ) : (medicos.data ?? []).length === 0 ? (
          <p className="text-sm text-cc-muted">Nenhum boleto nesta competência.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead className="border-b border-cc-hairline bg-cc-surface-2">
                <tr>
                  <th>{rotuloPessoa}</th>
                  <th className="text-right">Emitido</th>
                  <th className="text-right">Recebido</th>
                  <th className="text-right">Vencido</th>
                  <th className="text-right">Inadimpl.</th>
                  <th className="text-right">Ticket médio</th>
                </tr>
              </thead>
              <tbody>
                {(medicos.data ?? []).map((m) => (
                  <tr key={m.medicoId ?? m.nome}>
                    <td className="font-medium">{m.nome}</td>
                    <td className="text-right tabular">{brl(m.totalEmitido)}</td>
                    <td className="text-right tabular text-cc-success">{brl(m.totalRecebido)}</td>
                    <td className="text-right tabular text-cc-warning">{brl(m.totalVencido)}</td>
                    <td className="text-right tabular">{pct(m.taxaInadimplencia)}</td>
                    <td className="text-right tabular text-cc-ink-2">{brl(m.ticketMedio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Kpi({ label, valor, tom = 'default' }: { label: string; valor: string; tom?: 'default' | 'success' | 'warning' | 'danger' }) {
  const cor =
    tom === 'success' ? 'text-cc-success'
    : tom === 'warning' ? 'text-cc-warning'
    : tom === 'danger' ? 'text-cc-danger'
    : 'text-cc-ink';
  return (
    <div className="card p-4">
      <p className="font-mono text-2xs uppercase tracking-wider text-cc-muted">{label}</p>
      <p className={`mt-1 tabular text-lg font-semibold ${cor}`}>{valor}</p>
    </div>
  );
}
