'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContaEmissora } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL, CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';
import { dashboardService, dashboardQueryKeys } from '@/services/dashboard';
import { SaldoEmpresas } from '@/components/dashboard/SaldoEmpresas';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function pct(v: number): string {
  return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function DashboardManager() {
  const [competencia, setCompetencia] = useState<string>('');
  const filtro = competencia || undefined; // undefined = "Todas" (linha de rollup no banco)
  const [contaEmissora, setContaEmissora] = useState<ContaEmissora | ''>('');
  const contaFiltro = contaEmissora || undefined; // undefined = "Todas as contas" (linha de rollup no banco)

  // A view retorna as linhas por competência + a linha de rollup (competencia = null = total geral).
  const comps = useQuery({
    queryKey: dashboardQueryKeys.competencias(contaFiltro),
    queryFn: () => dashboardService.competencias(undefined, contaFiltro),
  });
  const medicos = useQuery({
    queryKey: dashboardQueryKeys.medicos(filtro, contaFiltro),
    queryFn: () => dashboardService.medicos(filtro, contaFiltro),
  });
  const agingQ = useQuery({
    queryKey: dashboardQueryKeys.aging(filtro, contaFiltro),
    queryFn: () => dashboardService.aging(filtro, contaFiltro),
  });

  const linhas = useMemo(() => comps.data ?? [], [comps.data]);
  // Opções do seletor: só competências reais (exclui a linha de rollup).
  const competencias = useMemo(() => linhas.filter((c) => c.competencia !== null), [linhas]);

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

      {/* Por médico */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-cc-ink">Por médico <span className="font-normal text-cc-muted">· {escopo}</span></h2>
        {medicos.isLoading ? (
          <Skeleton className="h-40" />
        ) : (medicos.data ?? []).length === 0 ? (
          <p className="text-sm text-cc-muted">Nenhum boleto nesta competência.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead className="border-b border-cc-hairline bg-cc-surface-2">
                <tr>
                  <th>Médico</th>
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
