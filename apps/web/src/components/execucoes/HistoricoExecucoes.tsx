'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';

function brl(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Histórico de execuções passadas (PRD §8.5).
export function HistoricoExecucoes() {
  const { data, isLoading } = useQuery({
    queryKey: execucaoQueryKeys.execucoes(),
    queryFn: () => execucoesService.listar(),
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Execuções</h1>
        <Link href="/execucoes/nova" className="rounded bg-gray-900 px-4 py-2 text-sm text-white">
          Nova execução
        </Link>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2">Competência</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">OK</th>
                <th className="px-3 py-2">Revisão</th>
                <th className="px-3 py-2">Sem dados</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-3 py-2">{e.competencia}</td>
                  <td className="px-3 py-2">{e.status}</td>
                  <td className="px-3 py-2">{e.totalOk ?? '—'}</td>
                  <td className="px-3 py-2">{e.totalAlerta ?? '—'}</td>
                  <td className="px-3 py-2">{e.totalSemDados ?? '—'}</td>
                  <td className="px-3 py-2">{brl(e.totalGeralValor)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/execucoes/${e.id}`} className="text-blue-600 underline">
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    Nenhuma execução ainda.
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
