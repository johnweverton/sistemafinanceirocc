'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { clientesContabilidadeService, clienteContabilidadeQueryKeys } from '@/services/clientes-contabilidade';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { boletosService } from '@/services/boletos';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';
import { useToast } from '@/components/ui/Toast';
import { CampoCompetencia } from '@/components/ui/CampoCompetencia';
import { cicloAdicionalVencendoNaCompetencia } from '@/lib/adicional-semestral';
import { competenciaAtual } from '@/lib/competencia';
import { brl } from '@/lib/formato';

export function GerarExecucao({ clienteId }: { clienteId: string }) {
  const { toast } = useToast();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [ehAdicional, setEhAdicional] = useState(false);
  const [execucaoId, setExecucaoId] = useState<string | null>(null);

  const { data: cliente } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.cliente(clienteId),
    queryFn: () => clientesContabilidadeService.detalhe(clienteId),
  });

  const cicloVencendo =
    !!cliente?.adicionalAtivo &&
    !!cliente.adicionalCompetenciaBase &&
    !!cliente.adicionalIntervaloMeses &&
    cicloAdicionalVencendoNaCompetencia(cliente.adicionalCompetenciaBase, cliente.adicionalIntervaloMeses, competencia);

  // Sugestão de UI (nunca dispara nada sozinha, PRD §2) — pré-marca o toggle quando a competência
  // bate o ciclo; o operador ainda pode desmarcar/marcar manualmente antes de confirmar.
  useEffect(() => {
    setEhAdicional(cicloVencendo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cicloVencendo, cliente?.id]);

  const disparar = useMutation({
    mutationFn: () => execucoesService.disparar(competencia, [], undefined, clienteId, ehAdicional),
    onSuccess: (r) => setExecucaoId(r.execucaoId),
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao calcular valor', 'error'),
  });

  return (
    <section className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Emissão</h1>
          {cliente && <p className="mt-0.5 text-sm text-cc-ink-2">{cliente.nome}</p>}
        </div>
        <Link href="/clientes-contabilidade" className="btn-ghost btn btn-sm">
          Voltar
        </Link>
      </div>
      <p className="-mt-4 text-2xs text-cc-muted">
        Fluxo em 2 passos: calcule o valor da competência, confira o resultado e só então emita o
        boleto.
      </p>

      {!execucaoId && (
        <div className="card space-y-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CampoCompetencia value={competencia} onChange={setCompetencia} />
            <div className="flex items-end">
              <button
                onClick={() => disparar.mutate()}
                disabled={disparar.isPending || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)}
                className="btn-primary"
              >
                {disparar.isPending ? 'Calculando...' : 'Calcular valor'}
              </button>
            </div>
          </div>

          {cliente?.adicionalAtivo && (
            <div className="rounded-lg border border-cc-hairline bg-cc-surface-2/50 p-4">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={ehAdicional}
                  onChange={(e) => setEhAdicional(e.target.checked)}
                  className="h-4 w-4 rounded border-cc-hairline accent-cc-accent"
                />
                <span className="text-sm text-cc-ink-2">
                  Gerar o adicional semestral desta competência ({brl(cliente.adicionalValor)}) em
                  vez do boleto mensal
                </span>
              </label>
              {cicloVencendo && (
                <p className="mt-1.5 text-2xs text-cc-muted">
                  Esta competência bate o ciclo do adicional semestral. Toggle pré-marcado (confirme antes de gerar).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {execucaoId && <Acompanhamento execucaoId={execucaoId} />}
    </section>
  );
}

// Exportado para reaproveitamento pelo fluxo combinado faturamento+emissão de clientes
// `faixa_faturamento` (FaturamentoEEmissao.tsx) — mesma lógica de acompanhar a execução e emitir
// o boleto, sem duplicar código (Story de polimento UX, 2026-07-30).
export function Acompanhamento({ execucaoId }: { execucaoId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { execucao } = useExecucaoRealtime(execucaoId);

  const { data: resultados } = useQuery({
    queryKey: execucaoQueryKeys.resultados(execucaoId),
    queryFn: () => execucoesService.resultados(execucaoId),
    enabled: execucao?.status === 'concluido',
  });
  const resultado = resultados?.[0];

  const emitir = useMutation({
    mutationFn: () => boletosService.emitir(resultado!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) });
      toast('Boleto emitido com sucesso', 'success');
    },
    onError: (e) => toast(e instanceof ApiClientError ? e.message : 'Erro ao emitir boleto', 'error'),
  });

  return (
    <div className="card space-y-4 p-6">
      {execucao?.status === 'processando' && <p className="text-sm text-cc-muted">Processando…</p>}
      {execucao?.status === 'erro' && <p className="alert-error">Falha ao processar a execução.</p>}

      {execucao?.status === 'concluido' && resultado && (
        <div className="space-y-3">
          <p className="text-sm text-cc-ink-2">
            Status: <span className={resultado.status === 'ok' ? 'badge-green' : 'badge-slate'}>{resultado.status}</span>
          </p>
          <p className="text-lg font-semibold text-cc-ink tabular">
            Valor calculado: {brl(resultado.totalValor)}
          </p>
          {resultado.alertas.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-cc-danger">
              {resultado.alertas.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {resultado.status === 'ok' && (
            <button onClick={() => emitir.mutate()} disabled={emitir.isPending} className="btn-primary">
              {emitir.isPending ? 'Emitindo...' : 'Emitir boleto'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
