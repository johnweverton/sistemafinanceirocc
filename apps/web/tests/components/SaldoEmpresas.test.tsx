// Teste dos cards de saldo por empresa no dashboard (Story 8.3, AC 2) — degradação por
// conta: não configurada e indisponível NUNCA quebram o dashboard.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSaldos = vi.fn();
vi.mock('../../src/services/contas', () => ({
  contasService: { saldos: (...a: unknown[]) => mockSaldos(...a) },
  contasQueryKeys: { saldos: () => ['contas', 'saldos'] },
}));

import { SaldoEmpresas } from '../../src/components/dashboard/SaldoEmpresas';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SaldoEmpresas />
    </QueryClientProvider>,
  );
}

describe('SaldoEmpresas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra o saldo da conta configurada e "não configurada" para a outra — sem erro', async () => {
    mockSaldos.mockResolvedValue([
      {
        conta: 'mc', nome: 'MC', configurada: true,
        saldo: { disponivel: 15320.45, bloqueado: null, consultadoEm: '2026-07-11T10:00:00Z' },
      },
      { conta: 'cavalcante_viana', nome: 'Cavalcante Viana', configurada: false, saldo: null },
    ]);
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Saldo em conta · MC')).toBeInTheDocument());
    expect(
      screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 15.320,45'),
    ).toBeInTheDocument();
    expect(screen.getByText('Saldo em conta · Cavalcante Viana')).toBeInTheDocument();
    expect(screen.getByText(/Conta não configurada/)).toBeInTheDocument();
  });

  it('conta configurada com consulta falha mostra "indisponível" com role=alert', async () => {
    mockSaldos.mockResolvedValue([
      { conta: 'mc', nome: 'MC', configurada: true, saldo: null, erro: 'timeout' },
    ]);
    renderComProviders();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Saldo indisponível no momento/)).toBeInTheDocument();
  });

  it('falha geral da rota não quebra o dashboard (renderiza vazio)', async () => {
    mockSaldos.mockRejectedValue(new Error('rede fora'));
    const { container } = renderComProviders();

    await waitFor(() => expect(mockSaldos).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.card')).toBeNull());
  });

  it('saldo negativo mostra alerta de saldo negativo (melhoria pós-Épico 8/9)', async () => {
    mockSaldos.mockResolvedValue([
      {
        conta: 'mc', nome: 'MC', configurada: true,
        saldo: { disponivel: -150.32, bloqueado: null, consultadoEm: '2026-07-29T10:00:00Z' },
      },
    ]);
    renderComProviders();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Saldo negativo: verificar lançamentos')).toBeInTheDocument();
    expect(
      screen.getByText((t) => t.replace(/ /g, ' ') === '-R$ 150,32'),
    ).toBeInTheDocument();
  });
});
