// Teste do componente de Contas a Receber (Story 4.4) — service mockado + react-query.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockListar = vi.fn();
vi.mock('../../src/services/recebiveis', () => ({
  recebiveisService: { listar: (...a: unknown[]) => mockListar(...a) },
  recebiveisQueryKeys: { recebiveis: (f: unknown) => ['recebiveis', f] },
}));

import { RecebiveisManager } from '../../src/components/recebiveis/RecebiveisManager';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecebiveisManager />
    </QueryClientProvider>,
  );
}

describe('RecebiveisManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderiza recebíveis com o badge de status correto', async () => {
    mockListar.mockResolvedValue([
      { boletoId: 'b1', execucaoResultadoId: 'r1', idExterno: 'inv_1', competencia: '2026-06',
        medicoId: 'm1', nome: 'Dr. Pago', valor: 1500, vencimento: '2026-07-01',
        pagoEm: '2026-06-15T00:00:00Z', valorPago: 1500, emitidoEm: '2026-06-01T00:00:00Z', statusDerivado: 'pago' },
      { boletoId: 'b2', execucaoResultadoId: 'r2', idExterno: 'inv_2', competencia: '2026-06',
        medicoId: 'm2', nome: 'Dra. Vencida', valor: 800, vencimento: '2020-01-01',
        pagoEm: null, valorPago: null, emitidoEm: '2026-06-01T00:00:00Z', statusDerivado: 'vencido' },
    ]);

    renderComProviders();

    await waitFor(() => expect(screen.getByText('Dr. Pago')).toBeInTheDocument());
    expect(screen.getByText('Dra. Vencida')).toBeInTheDocument();
    // Badges dentro da tabela (o filtro de status também tem <option> com o mesmo texto).
    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('Pago')).toBeInTheDocument();
    expect(within(tabela).getByText('Vencido')).toBeInTheDocument();
  });

  it('mostra empty state quando não há recebíveis', async () => {
    mockListar.mockResolvedValue([]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText(/Nenhum recebível encontrado/i)).toBeInTheDocument());
  });
});
