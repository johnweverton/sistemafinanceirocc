// Teste de componente — LancamentoFaturamento (Story 11.2). Mocka o service (sem I/O) e envolve
// com QueryClientProvider (useQuery/useMutation exigem o contexto) — mesmo padrão de
// MedicoForm.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';
import { LancamentoFaturamento } from '../../src/components/clientes-contabilidade/LancamentoFaturamento';
import { clientesContabilidadeService } from '../../src/services/clientes-contabilidade';

vi.mock('../../src/services/clientes-contabilidade', () => ({
  clientesContabilidadeService: {
    detalhe: vi.fn(),
    listarFaturamentos: vi.fn(),
    lancarFaturamento: vi.fn(),
  },
  clienteContabilidadeQueryKeys: {
    cliente: (id: string) => ['clientes-contabilidade', id] as const,
    clienteFaturamentos: (id: string) => ['clientes-contabilidade', id, 'faturamentos'] as const,
  },
}));

function renderComQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const clienteFaixa = {
  id: 'cc-1',
  nome: 'Padaria Bom Pão Ltda',
  regimeTributario: 'simples_nacional' as const,
  modoCobranca: 'faixa_faturamento' as const,
  regraPreco: null,
  cobranca: null,
  contaEmissora: 'mc' as const,
  condicoes: null,
  adicionalAtivo: false,
  adicionalValor: null,
  adicionalIntervaloMeses: null,
  adicionalCompetenciaBase: null,
  ativo: true,
  createdAt: '2026-07-24T00:00:00Z',
  updatedAt: '2026-07-24T00:00:00Z',
};

beforeEach(() => {
  vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue(clienteFaixa);
  vi.mocked(clientesContabilidadeService.listarFaturamentos).mockResolvedValue([]);
});

describe('LancamentoFaturamento', () => {
  it('bloqueia lançar até competência e faturamento válidos', async () => {
    renderComQuery(<LancamentoFaturamento clienteId="cc-1" />);
    await waitFor(() => expect(screen.getByText(/Padaria Bom Pão Ltda/)).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Lançar e calcular boleto/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Faturamento do mês/i), { target: { value: '4500' } });
    expect(screen.getByRole('button', { name: /Lançar e calcular boleto/i })).toBeEnabled();
  });

  it('envia competência + faturamento ao lançar', async () => {
    vi.mocked(clientesContabilidadeService.lancarFaturamento).mockResolvedValue({
      faturamento: {
        id: 'fat-1',
        clienteContabilidadeId: 'cc-1',
        competencia: '2026-07',
        faturamento: 4500,
        informadoPor: 'user-1',
        informadoEm: '2026-07-24T00:00:00Z',
      },
      preview: { valor: 250, alertas: [], subtotalFaixa: 'faturamento R$4500.00 < R$5000.00 → R$250.00' },
    });

    renderComQuery(<LancamentoFaturamento clienteId="cc-1" />);
    await waitFor(() => expect(screen.getByText(/Padaria Bom Pão Ltda/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Competência/i), { target: { value: '2026-07' } });
    fireEvent.change(screen.getByLabelText(/Faturamento do mês/i), { target: { value: '4500' } });
    fireEvent.click(screen.getByRole('button', { name: /Lançar e calcular boleto/i }));

    await waitFor(() =>
      expect(clientesContabilidadeService.lancarFaturamento).toHaveBeenCalledWith('cc-1', {
        competencia: '2026-07',
        faturamento: 4500,
      }),
    );
  });

  it('cliente no modo fixo mostra aviso em vez do formulário', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue({
      ...clienteFaixa,
      modoCobranca: 'fixo',
    });
    renderComQuery(<LancamentoFaturamento clienteId="cc-1" />);
    await waitFor(() =>
      expect(screen.getByText(/não usa lançamento de faturamento mensal/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Lançar e calcular boleto/i })).not.toBeInTheDocument();
  });
});
