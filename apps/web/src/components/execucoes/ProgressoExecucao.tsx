'use client';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';

export function ProgressoExecucao({ execucaoId }: { execucaoId: string }) {
  const { execucao } = useExecucaoRealtime(execucaoId);

  if (!execucao) {
    return <p className="text-sm text-cc-muted">Aguardando dados...</p>;
  }

  if (execucao.status === 'processando') {
    return (
      <div role="status" aria-live="polite" className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-cc-ink">Processando médicos</p>
          <span className="tabular text-sm font-semibold text-cc-accent">{execucao.progresso}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-cc-hairline">
          <div
            className="h-full rounded-full bg-cc-accent transition-all duration-500"
            style={{ width: `${execucao.progresso}%` }}
          />
        </div>
        <p className="text-xs text-cc-muted">Isso pode levar alguns minutos...</p>
      </div>
    );
  }

  if (execucao.status === 'erro') {
    return (
      <p role="alert" className="alert-error">
        A execução encontrou um erro. Tente reprocessar a competência.
      </p>
    );
  }

  return (
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
