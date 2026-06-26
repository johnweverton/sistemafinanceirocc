'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';
import { ProgressoExecucao } from './ProgressoExecucao';
import { RelatorioGrupos } from './RelatorioGrupos';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';

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
    onError: (e) => setErro(e instanceof ApiClientError ? e.message : 'Erro ao disparar execucao'),
  });

  if (execucaoId) {
    return <Acompanhamento execucaoId={execucaoId} onNova={() => setExecucaoId(null)} />;
  }

  const competenciaValida = /^\d{4}-\d{2}$/.test(competencia);

  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Nova execucao</h1>
      </div>

      <div className="card max-w-md p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (competenciaValida) disparar.mutate(competencia);
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="competencia" className="field-label mb-1.5">
              Competencia
            </label>
            <input
              id="competencia"
              name="competencia"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              placeholder="2026-06"
              className="input font-mono"
              maxLength={7}
            />
            <p className="mt-1.5 text-xs text-cc-muted">Formato: AAAA-MM</p>
          </div>

          {erro && <p role="alert" className="alert-error">{erro}</p>}

          <button
            type="submit"
            disabled={!competenciaValida || disparar.isPending}
            className="btn-primary w-full py-2.5"
          >
            {disparar.isPending ? 'Disparando...' : 'Processar competencia'}
          </button>
        </form>
      </div>
    </section>
  );
}

function Acompanhamento({ execucaoId, onNova }: { execucaoId: string; onNova: () => void }) {
  const { execucao } = useExecucaoRealtime(execucaoId);
  const concluido = execucao?.status === 'concluido';

  return (
    <section className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Execucao em andamento</h1>
          {execucao?.competencia && (
            <p className="mt-0.5 text-sm text-cc-ink-2 tabular font-mono">{execucao.competencia}</p>
          )}
        </div>
        <button onClick={onNova} className="btn-ghost btn btn-sm">
          Nova execucao
        </button>
      </div>
      <ProgressoExecucao execucaoId={execucaoId} />
      {concluido && <RelatorioGrupos execucaoId={execucaoId} />}
    </section>
  );
}
