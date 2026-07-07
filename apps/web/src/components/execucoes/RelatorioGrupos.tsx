'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ExecucaoResultado } from '@cobranca/shared';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { boletosService, CAMPO_COBRANCA_LABEL } from '@/services/boletos';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Relatório em três grupos: ok / alerta / sem_dados (PRD §8.4).
export function RelatorioGrupos({ execucaoId }: { execucaoId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: execucaoQueryKeys.resultados(execucaoId),
    queryFn: () => execucoesService.resultados(execucaoId),
  });
  const { toast } = useToast();
  const [emitidos, setEmitidos] = useState<Set<string>>(new Set());

  // Emissão é manual, um resultado por vez (PRD §10) — sem lote, sem automação.
  const emitir = useMutation({
    mutationFn: (resultadoId: string) => boletosService.emitir(resultadoId),
    onSuccess: (_res, resultadoId) => {
      setEmitidos((prev) => new Set(prev).add(resultadoId));
      toast('Boleto emitido com sucesso', 'success');
    },
    onError: (e, resultadoId) => {
      if (e instanceof ApiClientError) {
        if (e.code === 'BOLETO_JA_EMITIDO') {
          setEmitidos((prev) => new Set(prev).add(resultadoId));
          toast('Este resultado já tem boleto emitido', 'info');
          return;
        }
        if (e.code === 'COBRANCA_INCOMPLETA') {
          const faltantes = (e.details?.faltantes as string[] | undefined) ?? [];
          const labels = faltantes.map((f) => CAMPO_COBRANCA_LABEL[f] ?? f).join(', ');
          toast(
            `Dados de cobrança incompletos (${labels || 'campos obrigatórios'}). Complete o cadastro do médico em Médicos.`,
            'error',
          );
          return;
        }
        toast(e.message, 'error');
        return;
      }
      toast('Erro ao emitir boleto', 'error');
    },
  });

  if (isLoading) return <p className="text-sm text-cc-muted">Carregando relatório…</p>;
  if (error) return <p className="alert-error">Falha ao carregar o relatório.</p>;

  const todos = data ?? [];
  const ok = todos.filter((r) => r.status === 'ok');
  const alerta = todos.filter((r) => r.status === 'alerta');
  const semDados = todos.filter((r) => r.status === 'sem_dados');
  const totalGeral = todos.reduce((s, r) => s + (r.totalValor ?? 0), 0);

  return (
    <div className="space-y-8">
      <Grupo
        titulo="Prontos para emissão"
        count={ok.length}
        cor="green"
        resultados={ok}
        emitidos={emitidos}
        emitindoId={emitir.isPending ? emitir.variables : null}
        onEmitir={(id) => emitir.mutate(id)}
      />
      <Grupo titulo="Requerem revisão" count={alerta.length} cor="amber" resultados={alerta} mostrarAlertas />
      <Grupo titulo="Sem dados no sistema" count={semDados.length} cor="gray" resultados={semDados} resumido />
      <div className="flex items-center justify-between border-t border-cc-hairline pt-4">
        <span className="font-mono text-2xs uppercase tracking-wider text-cc-muted">Total geral</span>
        <span className="tabular text-lg font-semibold text-cc-ink">{brl(totalGeral)}</span>
      </div>
    </div>
  );
}

function Grupo({
  titulo,
  count,
  cor,
  resultados,
  mostrarAlertas = false,
  resumido = false,
  emitidos,
  emitindoId,
  onEmitir,
}: {
  titulo: string;
  count: number;
  cor: 'green' | 'amber' | 'gray';
  resultados: ExecucaoResultado[];
  mostrarAlertas?: boolean;
  resumido?: boolean;
  emitidos?: Set<string>;
  emitindoId?: string | null;
  onEmitir?: (resultadoId: string) => void;
}) {
  const barra =
    cor === 'green' ? 'bg-cc-success' : cor === 'amber' ? 'bg-cc-warning' : 'bg-cc-muted';
  const badge =
    cor === 'green' ? 'badge-green' : cor === 'amber' ? 'badge-amber' : 'badge-slate';

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 text-base font-semibold text-cc-ink">
        <span className={`h-4 w-1 rounded-full ${barra}`} />
        {titulo}
        <span className={badge}>{count}</span>
      </h2>
      {resultados.length === 0 ? (
        <p className="pl-3.5 text-sm text-cc-muted">Nenhum médico neste grupo.</p>
      ) : (
        <ul className="space-y-2.5">
          {resultados.map((r) => (
            <li key={r.id} className="card card-interactive p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-cc-ink">{r.nome}</span>
                {!resumido && (
                  <span className="tabular font-semibold text-cc-ink">{brl(r.totalValor ?? 0)}</span>
                )}
              </div>
              {!resumido && (
                <div className="mt-1 font-mono text-2xs uppercase tracking-wide text-cc-muted">
                  {r.guias ?? 0} guias · {r.cirurgias ?? 0} cirurgias · consolidado {r.guiasConsolidado ?? 0}
                </div>
              )}
              {!resumido && r.subtotais && r.subtotais.length > 0 && (
                <table className="mt-3 w-full text-xs">
                  <tbody>
                    {r.subtotais.map((s, i) => (
                      <tr key={i} className="border-t border-cc-hairline">
                        <td className="py-1.5 text-cc-ink-2">{s.classe}</td>
                        <td className="py-1.5 tabular text-cc-ink-2">{s.guias} guias</td>
                        <td className="py-1.5 text-cc-muted">{s.faixa}</td>
                        <td className="py-1.5 text-right tabular text-cc-ink">{brl(s.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {mostrarAlertas &&
                r.alertas.map((a, i) => (
                  <p key={i} className="mt-1.5 flex gap-1.5 text-xs text-cc-warning">
                    <span aria-hidden>→</span> {a}
                  </p>
                ))}
              {resumido && r.alertas[0] && <p className="mt-1 text-xs text-cc-muted">{r.alertas[0]}</p>}
              {onEmitir && (
                <div className="mt-3 flex items-center justify-end border-t border-cc-hairline pt-3">
                  {emitidos?.has(r.id) ? (
                    <span className="badge-green">Boleto emitido</span>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary btn btn-sm"
                      disabled={emitindoId != null}
                      onClick={() => onEmitir(r.id)}
                    >
                      {emitindoId === r.id ? 'Emitindo…' : 'Emitir boleto'}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
