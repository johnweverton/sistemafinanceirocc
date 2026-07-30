'use client';
import { useQuery } from '@tanstack/react-query';
import { clientesContabilidadeService, clienteContabilidadeQueryKeys } from '@/services/clientes-contabilidade';
import { GerarExecucao } from './GerarExecucao';
import { FaturamentoEEmissao } from './FaturamentoEEmissao';

/**
 * Ponto de entrada único da rota `/clientes-contabilidade/[id]/execucao` (Story de polimento UX,
 * 2026-07-30): decide qual fluxo mostrar conforme o modo de cobrança do cliente. Clientes `fixo`
 * seguem exatamente o fluxo antigo de `GerarExecucao.tsx` (calcular + emitir, sem faturamento).
 * Clientes `faixa_faturamento` usam o fluxo combinado `FaturamentoEEmissao.tsx` (lançar
 * faturamento e, na sequência, calcular e emitir — mesma competência, sem digitar duas vezes).
 * A query de detalhe do cliente é a mesma chave usada dentro de `GerarExecucao`/
 * `FaturamentoEEmissao`, então o react-query deduplica — não há fetch extra.
 */
export function EmissaoCliente({ clienteId }: { clienteId: string }) {
  const { data: cliente, isLoading } = useQuery({
    queryKey: clienteContabilidadeQueryKeys.cliente(clienteId),
    queryFn: () => clientesContabilidadeService.detalhe(clienteId),
  });

  if (isLoading) return <p className="text-sm text-cc-muted">Carregando…</p>;
  if (!cliente) return <p className="alert-error">Cliente contábil não encontrado.</p>;

  return cliente.modoCobranca === 'faixa_faturamento'
    ? <FaturamentoEEmissao clienteId={clienteId} />
    : <GerarExecucao clienteId={clienteId} />;
}
