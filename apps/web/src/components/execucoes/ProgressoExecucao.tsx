'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { useToast } from '@/components/ui/Toast';

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Acima de maxDuration (300s) + margem, uma execução ainda em "processando" provavelmente
// travou por falha de encadeamento entre lotes — oferece retomada manual em vez de deixar o
// usuário esperando indefinidamente sem ação possível.
const LIMIAR_TRAVADA_MS = 6 * 60 * 1000;

export function ProgressoExecucao({ execucaoId }: { execucaoId: string }) {
  const { execucao } = useExecucaoRealtime(execucaoId);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [travada, setTravada] = useState(false);

  useEffect(() => {
    if (execucao?.status !== 'processando') {
      setTravada(false);
      return;
    }
    const iniciadoEm = new Date(execucao.iniciadoEm).getTime();
    const restante = LIMIAR_TRAVADA_MS - (Date.now() - iniciadoEm);
    if (restante <= 0) {
      setTravada(true);
      return;
    }
    const timer = setTimeout(() => setTravada(true), restante);
    return () => clearTimeout(timer);
  }, [execucao?.status, execucao?.iniciadoEm]);

  const retomar = useMutation({
    mutationFn: () => execucoesService.retomar(execucaoId),
    onSuccess: () => {
      toast('Execução retomada', 'success');
      setTravada(false);
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucao(execucaoId) });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Falha ao retomar execução';
      toast(msg, 'error');
    },
  });

  if (!execucao) {
    return <p className="text-sm text-cc-muted">Aguardando dados...</p>;
  }

  return (
    <div className="space-y-2">
      {execucao.status === 'processando' && (
        <div role="status" aria-live="polite" className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-medium text-cc-ink">
              <span className="live-dot inline-block h-2 w-2 rounded-full bg-cc-accent" />
              Processando médicos
            </p>
            <span className="tabular text-sm font-semibold text-cc-accent">{execucao.progresso}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-cc-surface-2">
            <div
              className="progress-fill relative h-full overflow-hidden rounded-full transition-all duration-500"
              style={{ width: `${Math.max(execucao.progresso, 4)}%` }}
            >
              <span className="progress-stripes absolute inset-0" />
            </div>
          </div>
          {travada ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-2xs text-cc-warning">
                Isso está demorando mais que o esperado — a execução pode ter travado.
              </p>
              <button
                type="button"
                onClick={() => retomar.mutate()}
                disabled={retomar.isPending}
                className="btn-secondary shrink-0 text-xs"
              >
                {retomar.isPending ? 'Retomando…' : 'Reprocessar'}
              </button>
            </div>
          ) : (
            <p className="font-mono text-2xs uppercase tracking-wider text-cc-muted">
              Isso pode levar alguns minutos…
            </p>
          )}
        </div>
      )}

      {execucao.status === 'erro' && (
        <p role="alert" className="alert-error">
          A execução encontrou um erro. Tente reprocessar a competência.
        </p>
      )}

      {execucao.status === 'concluido' && (
        <div role="status" aria-live="polite" className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cc-success-soft">
              <svg className="h-3 w-3 text-cc-success" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </span>
            <span className="text-sm font-semibold text-cc-ink">Processamento concluído</span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat label="Ok" value={execucao.totalOk ?? 0} className="text-cc-success" />
            <Stat label="Em revisao" value={execucao.totalAlerta ?? 0} className="text-cc-warning" />
            <Stat label="Sem dados" value={execucao.totalSemDados ?? 0} className="text-cc-muted" />
          </div>
        </div>
      )}

      {execucao.iniciadoPorEmail && (
        <p className="font-mono text-2xs uppercase tracking-wider text-cc-muted">
          Disparado por {execucao.iniciadoPorEmail} em {formatarDataHora(execucao.iniciadoEm)}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div>
      <p className={`text-xl font-semibold tabular ${className ?? 'text-cc-ink'}`}>{value}</p>
      <p className="text-xs text-cc-muted mt-0.5">{label}</p>
    </div>
  );
}
