'use client';
import { useQuery } from '@tanstack/react-query';
import { medicosService, queryKeys } from '@/services/medicos';

// Timeline do histórico de alteração de um médico (PRD §8.2).
export function HistoricoTimeline({ medicoId }: { medicoId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.medicoHistorico(medicoId),
    queryFn: () => medicosService.historico(medicoId),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Carregando histórico…</p>;
  if (error) return <p className="text-sm text-red-600">Falha ao carregar histórico.</p>;
  if (!data || data.length === 0)
    return <p className="text-sm text-gray-500">Nenhuma alteração registrada.</p>;

  return (
    <ol className="space-y-3">
      {data.map((h) => (
        <li key={h.id} className="rounded border-l-4 border-gray-300 bg-white p-3 text-sm shadow-sm">
          <div className="font-medium">{h.campoAlterado}</div>
          <div className="text-gray-600">
            <span className="line-through">{h.valorAnterior || '—'}</span> →{' '}
            <strong>{h.valorNovo || '—'}</strong>
          </div>
          {h.motivo && <div className="mt-1 italic text-gray-500">Motivo: {h.motivo}</div>}
          <div className="mt-1 text-xs text-gray-400">
            {new Date(h.alteradoEm).toLocaleString('pt-BR')}
          </div>
        </li>
      ))}
    </ol>
  );
}
