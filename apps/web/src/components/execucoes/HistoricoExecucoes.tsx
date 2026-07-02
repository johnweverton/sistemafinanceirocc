'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

function brl(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'concluido') return <span className="badge-green">Concluído</span>;
  if (status === 'processando') return <span className="badge-amber">Processando</span>;
  return <span className="badge-red">Erro</span>;
}

export function HistoricoExecucoes() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: execucaoQueryKeys.execucoes(),
    queryFn: () => execucoesService.listar(),
  });

  const execucoes = data ?? [];

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Execuções</h1>
        <Link href="/execucoes/nova" className="btn-primary btn-sm btn">
          Nova execução
        </Link>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : execucoes.length === 0 ? (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
          title="Nenhuma execução registrada ainda"
          description="Dispare o processamento de uma competência para gerar o primeiro relatório."
          action={
            <Link href="/execucoes/nova" className="btn-primary btn-sm btn">
              Nova execução
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-surface-2">
              <tr>
                <th>Competência</th>
                <th>Status</th>
                <th className="text-right">Ok</th>
                <th className="text-right">Revisão</th>
                <th className="text-right">Sem dados</th>
                <th className="text-right">Total</th>
                <th className="text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {execucoes.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => router.push(`/execucoes/${e.id}`)}
                  className="cursor-pointer"
                >
                  <td className="font-mono font-medium tabular">{e.competencia}</td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="text-right tabular text-cc-ink-2">{e.totalOk ?? '-'}</td>
                  <td className="text-right tabular text-cc-warning">{e.totalAlerta ?? '-'}</td>
                  <td className="text-right tabular text-cc-muted">{e.totalSemDados ?? '-'}</td>
                  <td className="text-right tabular font-medium">{brl(e.totalGeralValor)}</td>
                  <td className="text-right">
                    <Link
                      href={`/execucoes/${e.id}`}
                      className="link-action"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      Abrir
                    </Link>
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
