// Teste de componente — FaturamentoEEmissao (polimento UX, 2026-07-30, item 7 do feedback do
// dono): fluxo combinado para clientes faixa_faturamento — lança o faturamento do mês e, na
// sequência, calcula/emite o boleto da MESMA competência, sem pedir a competência de novo.
// Mesmo padrão de mock de LancamentoFaturamento.test.tsx e GerarExecucao.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

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

vi.mock('../../src/services/execucoes', () => ({
  execucoesService: { disparar: vi.fn(), resultados: vi.fn() },
  execucaoQueryKeys: {
    resultados: (id: string) => ['execucoes', id, 'resultados'] as const,
  },
}));

vi.mock('../../src/services/boletos', () => ({
  boletosService: { emitir: vi.fn() },
}));

const mockUseExecucaoRealtime = vi.fn();
vi.mock('../../src/hooks/useExecucaoRealtime', () => ({
  useExecucaoRealtime: (id: string) => mockUseExecucaoRealtime(id),
}));

import { FaturamentoEEmissao } from '../../src/components/clientes-contabilidade/FaturamentoEEmissao';
import { clientesContabilidadeService } from '../../src/services/clientes-contabilidade';
import { execucoesService } from '../../src/services/execucoes';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <FaturamentoEEmissao clienteId="cc-1" />
      </ToastProvider>
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
  vi.clearAllMocks();
  vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue(clienteFaixa);
  vi.mocked(clientesContabilidadeService.listarFaturamentos).mockResolvedValue([]);
  mockUseExecucaoRealtime.mockReturnValue({ execucao: undefined });
});

describe('FaturamentoEEmissao', () => {
  it('lança o faturamento e, sem pedir a competência de novo, libera calcular/emitir', async () => {
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
    vi.mocked(execucoesService.disparar).mockResolvedValue({ execucaoId: 'exec-1' });

    renderComProviders();
    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /Calcular e emitir boleto/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });
    fireEvent.change(screen.getByLabelText(/Faturamento do mês/i), { target: { value: '4500' } });
    fireEvent.click(screen.getByRole('button', { name: /Lançar faturamento/i }));

    await waitFor(() =>
      expect(clientesContabilidadeService.lancarFaturamento).toHaveBeenCalledWith('cc-1', {
        competencia: '2026-07',
        faturamento: 4500,
      }),
    );

    const botaoEmitir = await screen.findByRole('button', { name: /Calcular e emitir boleto/i });
    fireEvent.click(botaoEmitir);

    await waitFor(() =>
      expect(execucoesService.disparar).toHaveBeenCalledWith('2026-07', [], undefined, 'cc-1', false),
    );
  });

  it('competência já lançada anteriormente libera calcular/emitir sem precisar relançar', async () => {
    vi.mocked(clientesContabilidadeService.listarFaturamentos).mockResolvedValue([
      {
        id: 'fat-0',
        clienteContabilidadeId: 'cc-1',
        competencia: '2026-06',
        faturamento: 4000,
        informadoPor: 'user-1',
        informadoEm: '2026-06-24T00:00:00Z',
      },
    ]);

    renderComProviders();
    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-06' } });

    expect(await screen.findByRole('button', { name: /Calcular e emitir boleto/i })).toBeInTheDocument();
    expect(clientesContabilidadeService.lancarFaturamento).not.toHaveBeenCalled();
  });

  it('cliente no modo fixo mostra aviso em vez do formulário combinado', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue({
      ...clienteFaixa,
      modoCobranca: 'fixo',
    });

    renderComProviders();
    await waitFor(() =>
      expect(screen.getByText(/não usa lançamento de faturamento mensal/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Lançar faturamento/i })).not.toBeInTheDocument();
  });
});
