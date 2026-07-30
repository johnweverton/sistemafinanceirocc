'use client';
import { useQuery } from '@tanstack/react-query';
import { clientesContabilidadeService, clienteContabilidadeQueryKeys } from '@/services/clientes-contabilidade';

// Timeline do histórico de alteração de um cliente contábil (Story 11.1, mesmo padrão de empresa).
export function HistoricoTimeline({ clienteId }: { clienteId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.clienteHistorico(clienteId),
    queryFn: () => clientesContabilidadeService.historico(clienteId),
  });

  if (isLoading) return <p className="text-sm text-cc-muted">Carregando histórico…</p>;
  if (error) return <p className="text-sm text-cc-danger">Falha ao carregar histórico.</p>;
  if (!data || data.length === 0)
    return <p className="text-sm text-cc-muted">Nenhuma alteração registrada.</p>;

  return (
    <ol className="space-y-3">
      {data.map((h) => (
        <li key={h.id} className="rounded border-l-4 border-cc-hairline bg-cc-surface p-3 text-sm shadow-cc-sm">
          <div className="font-medium text-cc-ink">{h.campoAlterado}</div>
          <div className="text-cc-ink-2">
            <span className="line-through">{h.valorAnterior || '-'}</span> →{' '}
            <strong className="text-cc-ink">{h.valorNovo || '-'}</strong>
          </div>
          {h.motivo && <div className="mt-1 text-cc-muted">Motivo: {h.motivo}</div>}
          <div className="mt-1 text-xs text-cc-muted">
            {new Date(h.alteradoEm).toLocaleString('pt-BR')}
          </div>
        </li>
      ))}
    </ol>
  );
}
