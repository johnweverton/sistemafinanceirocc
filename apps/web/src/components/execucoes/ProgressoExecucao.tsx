'use client';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';

// Mostra o progresso em tempo real de uma execução (architecture: Component Template).
export function ProgressoExecucao({ execucaoId }: { execucaoId: string }) {
  const { execucao } = useExecucaoRealtime(execucaoId);
  if (!execucao) return <p className="text-sm text-gray-500">Carregando…</p>;

  if (execucao.status === 'processando') {
    return (
      <div role="status" aria-live="polite" className="space-y-2">
        <p className="text-sm font-medium">Processando: {execucao.progresso}%</p>
        <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
          <div className="h-full bg-gray-900 transition-all" style={{ width: `${execucao.progresso}%` }} />
        </div>
      </div>
    );
  }

  if (execucao.status === 'erro') {
    return (
      <p role="alert" className="text-sm text-red-600">
        A execução falhou. Reprocesse a competência.
      </p>
    );
  }

  return (
    <p role="status" aria-live="polite" className="text-sm font-medium text-green-700">
      Concluído — {execucao.totalOk ?? 0} ok, {execucao.totalAlerta ?? 0} em revisão,{' '}
      {execucao.totalSemDados ?? 0} sem dados.
    </p>
  );
}
