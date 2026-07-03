'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FiltroRecebiveis, StatusRecebivel } from '@cobranca/shared';
import { recebiveisService, recebiveisQueryKeys } from '@/services/recebiveis';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

function brl(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function StatusBadge({ status }: { status: StatusRecebivel }) {
  if (status === 'pago') return <span className="badge-green">Pago</span>;
  if (status === 'vencido') return <span className="badge-amber">Vencido</span>;
  if (status === 'cancelado') return <span className="badge-red">Cancelado</span>;
  return <span className="badge-slate">Em aberto</span>;
}

const STATUS_OPCOES: { valor: StatusRecebivel | ''; label: string }[] = [
  { valor: '', label: 'Todos os status' },
  { valor: 'em_aberto', label: 'Em aberto' },
  { valor: 'vencido', label: 'Vencido' },
  { valor: 'pago', label: 'Pago' },
  { valor: 'cancelado', label: 'Cancelado' },
];

export function RecebiveisManager() {
  const [competencia, setCompetencia] = useState('');
  const [status, setStatus] = useState<StatusRecebivel | ''>('');

  const filtros: FiltroRecebiveis = {
    competencia: competencia || undefined,
    statusDerivado: status || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: recebiveisQueryKeys.recebiveis(filtros),
    queryFn: () => recebiveisService.listar(filtros),
  });

  const recebiveis = data ?? [];

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Contas a Receber</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            placeholder="Competência (AAAA-MM)"
            className="input font-mono w-40"
            maxLength={7}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusRecebivel | '')} className="input w-44">
            {STATUS_OPCOES.map((o) => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : recebiveis.length === 0 ? (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
            </svg>
          }
          title="Nenhum recebível encontrado"
          description="Boletos emitidos aparecem aqui com o status de pagamento. Ajuste os filtros ou emita boletos."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-surface-2">
              <tr>
                <th>Médico</th>
                <th>Competência</th>
                <th className="text-right">Valor</th>
                <th>Vencimento</th>
                <th>Status</th>
                <th className="text-right">Valor pago</th>
              </tr>
            </thead>
            <tbody>
              {recebiveis.map((r) => (
                <tr key={r.boletoId}>
                  <td className="font-medium">{r.nome}</td>
                  <td className="font-mono tabular text-cc-ink-2">{r.competencia}</td>
                  <td className="text-right tabular font-medium">{brl(r.valor)}</td>
                  <td className="font-mono tabular text-cc-ink-2">{r.vencimento ?? '—'}</td>
                  <td><StatusBadge status={r.statusDerivado} /></td>
                  <td className="text-right tabular text-cc-muted">
                    {r.pagoEm ? brl(r.valorPago) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
