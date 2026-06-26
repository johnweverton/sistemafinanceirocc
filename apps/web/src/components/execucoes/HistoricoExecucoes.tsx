'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';

function brl(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'concluido') return <span className="badge-green">Concluido</span>;
  if (status === 'processando') return <span className="badge-amber">Processando</span>;
  return <span className="badge-red">Erro</span>;
}

export function HistoricoExecucoes() {
  const { data, isLoading } = useQuery({
    queryKey: execucaoQueryKeys.execucoes(),
    queryFn: () => execucoesService.listar(),
  });

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Execucoes</h1>
        <Link href="/execucoes/nova" className="btn-primary btn-sm btn">
          Nova execucao
        </Link>
      </div>

      {isLoading ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-cc-muted">Carregando...</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-bg/60">
              <tr>
                <th>Competencia</th>
                <th>Status</th>
                <th className="text-right">Ok</th>
                <th className="text-right">Revisao</th>
                <th className="text-right">Sem dados</th>
                <th className="text-right">Total</th>
                <th className="text-right">Acao</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="font-mono font-medium tabular">{e.competencia}</td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="text-right tabular text-cc-ink-2">{e.totalOk ?? '-'}</td>
                  <td className="text-right tabular text-cc-warning">{e.totalAlerta ?? '-'}</td>
                  <td className="text-right tabular text-cc-muted">{e.totalSemDados ?? '-'}</td>
                  <td className="text-right tabular font-medium">{brl(e.totalGeralValor)}</td>
                  <td className="text-right">
                    <Link href={`/execucoes/${e.id}`} className="link-action">
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-cc-muted">
                    Nenhuma execucao registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
