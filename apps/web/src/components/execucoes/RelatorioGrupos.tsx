'use client';
import { useQuery } from '@tanstack/react-query';
import type { ExecucaoResultado } from '@cobranca/shared';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Relatório em três grupos: ok / alerta / sem_dados (PRD §8.4).
export function RelatorioGrupos({ execucaoId }: { execucaoId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: execucaoQueryKeys.resultados(execucaoId),
    queryFn: () => execucoesService.resultados(execucaoId),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Carregando relatório…</p>;
  if (error) return <p className="text-sm text-red-600">Falha ao carregar o relatório.</p>;

  const todos = data ?? [];
  const ok = todos.filter((r) => r.status === 'ok');
  const alerta = todos.filter((r) => r.status === 'alerta');
  const semDados = todos.filter((r) => r.status === 'sem_dados');
  const totalGeral = todos.reduce((s, r) => s + (r.totalValor ?? 0), 0);

  return (
    <div className="space-y-8">
      <Grupo titulo={`Prontos para emissão (${ok.length})`} cor="green" resultados={ok} />
      <Grupo titulo={`Requerem revisão (${alerta.length})`} cor="amber" resultados={alerta} mostrarAlertas />
      <Grupo titulo={`Sem dados no sistema (${semDados.length})`} cor="gray" resultados={semDados} resumido />
      <div className="border-t pt-3 text-right text-sm font-semibold">
        Total geral: {brl(totalGeral)}
      </div>
    </div>
  );
}

function Grupo({
  titulo,
  cor,
  resultados,
  mostrarAlertas = false,
  resumido = false,
}: {
  titulo: string;
  cor: 'green' | 'amber' | 'gray';
  resultados: ExecucaoResultado[];
  mostrarAlertas?: boolean;
  resumido?: boolean;
}) {
  const borda = cor === 'green' ? 'border-green-500' : cor === 'amber' ? 'border-amber-500' : 'border-gray-400';
  return (
    <section>
      <h2 className={`mb-2 border-l-4 ${borda} pl-2 text-base font-semibold`}>{titulo}</h2>
      {resultados.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhum médico neste grupo.</p>
      ) : (
        <ul className="space-y-3">
          {resultados.map((r) => (
            <li key={r.id} className="rounded border bg-white p-3 text-sm shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.nome}</span>
                {!resumido && <span className="text-gray-600">{brl(r.totalValor ?? 0)}</span>}
              </div>
              {!resumido && (
                <div className="text-xs text-gray-500">
                  {r.guias ?? 0} guias · {r.cirurgias ?? 0} cirurgias · consolidado{' '}
                  {r.guiasConsolidado ?? 0}
                </div>
              )}
              {!resumido && r.subtotais && r.subtotais.length > 0 && (
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {r.subtotais.map((s, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1">{s.classe}</td>
                        <td className="py-1">{s.guias} guias</td>
                        <td className="py-1 text-gray-500">{s.faixa}</td>
                        <td className="py-1 text-right">{brl(s.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {mostrarAlertas &&
                r.alertas.map((a, i) => (
                  <p key={i} className="mt-1 text-xs text-amber-700">
                    → {a}
                  </p>
                ))}
              {resumido && r.alertas[0] && <p className="text-xs text-gray-500">{r.alertas[0]}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
