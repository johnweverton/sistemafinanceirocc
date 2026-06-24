'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Execucao } from '@cobranca/shared';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { execucoesService, execucaoQueryKeys } from '@/services/execucoes';

/**
 * Acompanha uma execução: busca inicial via API + assinatura Realtime no Postgres Changes
 * da linha em `execucoes`. Cada mudança invalida a query, que rebusca o estado atual.
 * Quando conclui, também invalida os resultados (PRD §6.3, §8.4).
 */
export function useExecucaoRealtime(execucaoId: string): { execucao: Execucao | undefined } {
  const qc = useQueryClient();

  const { data: execucao } = useQuery({
    queryKey: execucaoQueryKeys.execucao(execucaoId),
    queryFn: () => execucoesService.detalhe(execucaoId),
    // Polling de fallback enquanto processa, caso o Realtime não esteja disponível.
    refetchInterval: (q) => (q.state.data?.status === 'processando' ? 3000 : false),
  });

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const canal = supabase
      .channel(`execucoes:${execucaoId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'execucoes', filter: `id=eq.${execucaoId}` },
        (payload) => {
          void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucao(execucaoId) });
          const novo = payload.new as { status?: string };
          if (novo.status === 'concluido') {
            void qc.invalidateQueries({ queryKey: execucaoQueryKeys.resultados(execucaoId) });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [execucaoId, qc]);

  return { execucao };
}
