'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { ProgressoExecucao } from './ProgressoExecucao';
import { RelatorioGrupos } from './RelatorioGrupos';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';

// Tela de disparo de competência (PRD §8.3). Após disparar, acompanha o progresso
// e mostra o relatório em 3 grupos quando concluir.
export function NovaExecucao() {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState('');
  const [execucaoId, setExecucaoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const disparar = useMutation({
    mutationFn: (c: string) => execucoesService.disparar(c),
    onSuccess: ({ execucaoId }) => {
      setExecucaoId(execucaoId);
      setErro(null);
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucoes() });
    },
    onError: (e) => setErro(e instanceof ApiClientError ? e.message : 'Erro ao disparar'),
  });

  if (execucaoId) {
    return <Acompanhamento execucaoId={execucaoId} onNova={() => setExecucaoId(null)} />;
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Nova execução</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{4}-\d{2}$/.test(competencia)) disparar.mutate(competencia);
        }}
        className="flex items-end gap-3"
      >
        <label className="block">
          <span className="text-sm font-medium">Competência (AAAA-MM)</span>
          <input
            name="competencia"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            placeholder="2026-06"
            className="mt-1 rounded border px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={!/^\d{4}-\d{2}$/.test(competencia) || disparar.isPending}
          className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {disparar.isPending ? 'Disparando…' : 'Processar'}
        </button>
      </form>
      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}
    </section>
  );
}

function Acompanhamento({ execucaoId, onNova }: { execucaoId: string; onNova: () => void }) {
  const { execucao } = useExecucaoRealtime(execucaoId);
  const concluido = execucao?.status === 'concluido';
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Execução {execucao?.competencia ?? ''}</h1>
        <button onClick={onNova} className="text-sm text-gray-600 underline">
          Nova execução
        </button>
      </div>
      <ProgressoExecucao execucaoId={execucaoId} />
      {concluido && <RelatorioGrupos execucaoId={execucaoId} />}
    </section>
  );
}
