// Teste do componente de Contas a Receber (Story 4.4 + cancelamento Story 6.1) —
// services mockados + react-query + ToastProvider.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockListar = vi.fn();
vi.mock('../../src/services/recebiveis', () => ({
  recebiveisService: { listar: (...a: unknown[]) => mockListar(...a) },
  recebiveisQueryKeys: { recebiveis: (f: unknown) => ['recebiveis', f] },
}));

const mockCancelar = vi.fn();
vi.mock('../../src/services/boletos', () => ({
  boletosService: { cancelar: (...a: unknown[]) => mockCancelar(...a) },
}));

import { RecebiveisManager } from '../../src/components/recebiveis/RecebiveisManager';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RecebiveisManager />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const recebivelPago = {
  boletoId: 'b1', execucaoResultadoId: 'r1', idExterno: 'inv_1', competencia: '2026-06',
  medicoId: 'm1', nome: 'Dr. Pago', valor: 1500, vencimento: '2026-07-01',
  pagoEm: '2026-06-15T00:00:00Z', valorPago: 1500, emitidoEm: '2026-06-01T00:00:00Z',
  contaEmissora: 'mc', statusDerivado: 'pago',
};
const recebivelVencido = {
  boletoId: 'b2', execucaoResultadoId: 'r2', idExterno: 'inv_2', competencia: '2026-06',
  medicoId: 'm2', nome: 'Dra. Vencida', valor: 800, vencimento: '2020-01-01',
  pagoEm: null, valorPago: null, emitidoEm: '2026-06-01T00:00:00Z',
  contaEmissora: 'cavalcante_viana', statusDerivado: 'vencido',
};

describe('RecebiveisManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderiza recebíveis com o badge de status correto', async () => {
    mockListar.mockResolvedValue([recebivelPago, recebivelVencido]);

    renderComProviders();

    await waitFor(() => expect(screen.getByText('Dr. Pago')).toBeInTheDocument());
    expect(screen.getByText('Dra. Vencida')).toBeInTheDocument();
    // Badges dentro da tabela (o filtro de status também tem <option> com o mesmo texto).
    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('Pago')).toBeInTheDocument();
    expect(within(tabela).getByText('Vencido')).toBeInTheDocument();
  });

  // Story 7.3 (AC 3): badge "Empresa" por linha + filtro por empresa emissora.
  it('mostra o badge da empresa emissora e filtra por empresa', async () => {
    mockListar.mockResolvedValue([recebivelPago, recebivelVencido]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Dr. Pago')).toBeInTheDocument());

    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('MC')).toBeInTheDocument();
    expect(within(tabela).getByText('Cavalcante Viana')).toBeInTheDocument();

    // Seleciona a empresa no filtro → nova query com contaEmissora.
    mockListar.mockResolvedValue([recebivelVencido]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por empresa emissora' }), {
      target: { value: 'cavalcante_viana' },
    });
    await waitFor(() =>
      expect(mockListar).toHaveBeenCalledWith(
        expect.objectContaining({ contaEmissora: 'cavalcante_viana' }),
      ),
    );
  });

  // Coluna "Pago em" (data da baixa) + destaque do valor pago quando difere do emitido.
  it('mostra a coluna "Pago em" e destaca o valor pago quando difere do emitido', async () => {
    const divergente = {
      ...recebivelPago,
      boletoId: 'b3',
      nome: 'Dr. Diferente',
      valor: 1000,
      valorPago: 1080, // pagou a mais (multa/juros) → destaque
      pagoEm: '2026-07-05T12:00:00Z',
    };
    mockListar.mockResolvedValue([recebivelPago, divergente, recebivelVencido]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Dr. Diferente')).toBeInTheDocument());

    const tabela = screen.getByRole('table');
    // Coluna nova existe.
    expect(within(tabela).getByText('Pago em')).toBeInTheDocument();

    // Valor pago divergente vem destacado (âmbar) e com tooltip explicando a diferença.
    const destacado = within(tabela).getByTitle(/pago/i);
    expect(destacado).toHaveClass('text-cc-warning');
    expect(destacado.textContent).toContain('1.080');

    // Valor pago igual ao emitido (Dr. Pago: 1500/1500) NÃO é destacado.
    expect(within(tabela).queryByTitle(/Emitido.*1\.500/)).not.toBeInTheDocument();
  });

  it('mostra empty state quando não há recebíveis', async () => {
    mockListar.mockResolvedValue([]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText(/Nenhum recebível encontrado/i)).toBeInTheDocument());
  });

  it('ação Cancelar aparece só para em_aberto/vencido — nunca para pago (Story 6.1)', async () => {
    mockListar.mockResolvedValue([recebivelPago, recebivelVencido]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Dra. Vencida')).toBeInTheDocument());

    const tabela = screen.getByRole('table');
    // 1 botão Cancelar (linha vencida); linha paga não tem ação.
    const botoes = within(tabela).getAllByRole('button', { name: 'Cancelar' });
    expect(botoes).toHaveLength(1);
  });

  it('fluxo de cancelamento: motivo obrigatório → confirma → chama o service (Story 6.1)', async () => {
    mockListar.mockResolvedValue([recebivelVencido]);
    mockCancelar.mockResolvedValue({ boleto: { id: 'b2', status: 'cancelado' } });
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Dra. Vencida')).toBeInTheDocument());

    // Abre o diálogo.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Cancelar boleto', { selector: 'h2' })).toBeInTheDocument();

    // Confirmação desabilitada sem motivo válido.
    const confirmar = screen.getByRole('button', { name: 'Cancelar boleto' });
    expect(confirmar).toBeDisabled();

    // Preenche o motivo → habilita → confirma.
    fireEvent.change(screen.getByLabelText(/Motivo do cancelamento/i), {
      target: { value: 'Valor errado — reemitir com valor correto' },
    });
    expect(confirmar).not.toBeDisabled();
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(mockCancelar).toHaveBeenCalledWith('b2', 'Valor errado — reemitir com valor correto'),
    );
  });
});
