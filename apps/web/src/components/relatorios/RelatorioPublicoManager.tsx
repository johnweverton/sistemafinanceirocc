'use client';
// BI público de Relatórios (link com token, sem login) — só leitura, sem mutations. Mesmo
// estilo visual do DashboardManager (KPIs em cards, barras Tailwind sem lib de gráfico), mas
// alimentado por dados 100% agregados (nunca nome de médico/boletoId — ver route.ts).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import {
  relatoriosPublicoService,
  relatoriosPublicoQueryKeys,
  RelatorioPublicoIndisponivel,
} from '@/services/relatorios-publico';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function pct(v: number): string {
  return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
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

export function RelatorioPublicoManager({ token }: { token: string }) {
  const [competencia, setCompetencia] = useState('');

  const respostaQ = useQuery({
    queryKey: relatoriosPublicoQueryKeys.resposta(token, competencia || undefined),
    queryFn: () => relatoriosPublicoService.buscar(token, competencia || undefined),
    retry: false,
  });

  if (respostaQ.isLoading) {
    return (
      <section className="mx-auto max-w-5xl space-y-5 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </section>
    );
  }

  if (respostaQ.isError) {
    const indisponivel = respostaQ.error instanceof RelatorioPublicoIndisponivel;
    return (
      <section className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6">
        <EmptyState
          title={indisponivel ? 'Link indisponível' : 'Não foi possível carregar'}
          description={
            indisponivel
              ? 'Este link foi revogado, expirou ou nunca existiu. Peça um novo link a quem administra o sistema.'
              : 'Tente novamente em instantes.'
          }
        />
      </section>
    );
  }

  const dados = respostaQ.data!;
  const agingMax = Math.max(1, ...dados.aging.map((a) => a.total));
  const empresaMax = Math.max(1, ...dados.porEmpresa.map((e) => e.totalEmitido));
  const tipoServicoMax = Math.max(1, ...dados.porTipoServico.map((t) => t.totalEmitido));
  const evolucaoMax = Math.max(1, ...dados.evolucaoMensal.map((m) => m.totalEmitido));
  const escopo = competencia ? `competência ${competencia}` : 'todas as competências';

  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{dados.nomeLink}</h1>
          <p className="text-xs text-cc-muted">
            {dados.escopoContaEmissora ? CONTA_EMISSORA_LABEL[dados.escopoContaEmissora] : 'Todas as empresas'} · Atualizado em{' '}
            {new Date(dados.geradoEm).toLocaleString('pt-BR')}
          </p>
        </div>
        <select value={competencia} onChange={(e) => setCompetencia(e.target.value)} className="input w-44" aria-label="Competência">
          <option value="">Todas as competências</option>
          {dados.competenciasDisponiveis.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Emitido" valor={brl(dados.kpi.totalEmitido)} />
        <Kpi label="Recebido" valor={brl(dados.kpi.totalRecebido)} tom="success" />
        <Kpi label="Em aberto" valor={brl(dados.kpi.totalEmAberto)} />
        <Kpi label="Vencido" valor={brl(dados.kpi.totalVencido)} tom="warning" />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-cc-ink">
          Por empresa <span className="font-normal text-cc-muted">· {escopo}</span>
        </h2>
        {dados.porEmpresa.length === 0 ? (
          <p className="text-sm text-cc-muted">Sem dados no período.</p>
        ) : (
          <div className="space-y-2">
            {dados.porEmpresa.map((e) => (
              <div key={e.contaEmissora} className="flex items-center gap-3">
                <span className="w-32 text-xs text-cc-muted">{e.contaEmissoraLabel}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-cc-surface-2">
                  <div className="progress-fill h-full rounded-full" style={{ width: `${(e.totalEmitido / empresaMax) * 100}%` }} />
                </div>
                <span className="tabular w-28 text-right text-sm text-cc-ink">{brl(e.totalEmitido)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-cc-ink">
          Cobrança Médica × Contabilidade <span className="font-normal text-cc-muted">· {escopo}</span>
        </h2>
        {dados.porTipoServico.length === 0 ? (
          <p className="text-sm text-cc-muted">Sem dados no período.</p>
        ) : (
          <div className="space-y-2">
            {dados.porTipoServico.map((t) => (
              <div key={t.tipoServico} className="flex items-center gap-3">
                <span className="w-32 text-xs text-cc-muted">{t.tipoServicoLabel}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-cc-surface-2">
                  <div className="progress-fill h-full rounded-full" style={{ width: `${(t.totalEmitido / tipoServicoMax) * 100}%` }} />
                </div>
                <span className="tabular w-28 text-right text-sm text-cc-ink">{brl(t.totalEmitido)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-cc-ink">Evolução mensal</h2>
        {dados.evolucaoMensal.length === 0 ? (
          <p className="text-sm text-cc-muted">Sem histórico ainda.</p>
        ) : (
          <div className="space-y-2">
            {dados.evolucaoMensal.map((m) => (
              <div key={m.competencia} className="flex items-center gap-3">
                <span className="w-16 font-mono text-2xs text-cc-muted">{m.competencia}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-cc-surface-2">
                  <div className="progress-fill h-full rounded-full" style={{ width: `${(m.totalEmitido / evolucaoMax) * 100}%` }} />
                </div>
                <span className="tabular w-28 text-right text-sm text-cc-ink">{brl(m.totalEmitido)}</span>
                <span className="w-16 text-right text-2xs text-cc-muted">{pct(m.taxaInadimplencia)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-cc-ink">
          Aging de vencidos <span className="font-normal text-cc-muted">· {escopo}</span>
        </h2>
        {dados.aging.length === 0 ? (
          <p className="text-sm text-cc-muted">Nenhum boleto vencido.</p>
        ) : (
          <div className="space-y-2">
            {dados.aging.map((a) => (
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
    </section>
  );
}
