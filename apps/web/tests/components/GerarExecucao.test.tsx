// Teste de componente — GerarExecucao (Story 11.3). Mocka os services e o hook de realtime
// (mesmo padrão de NovaExecucao.test.tsx — supabase realtime não é exercitado em teste unitário).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

vi.mock('../../src/services/clientes-contabilidade', () => ({
  clientesContabilidadeService: { detalhe: vi.fn() },
  clienteContabilidadeQueryKeys: {
    cliente: (id: string) => ['clientes-contabilidade', id] as const,
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

import { GerarExecucao } from '../../src/components/clientes-contabilidade/GerarExecucao';
import { clientesContabilidadeService } from '../../src/services/clientes-contabilidade';
import { execucoesService } from '../../src/services/execucoes';
import { boletosService } from '../../src/services/boletos';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <GerarExecucao clienteId="cc-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const clienteFixo = {
  id: 'cc-1',
  nome: 'Clínica X',
  regimeTributario: 'lucro_presumido' as const,
  modoCobranca: 'fixo' as const,
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
  vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue(clienteFixo);
  mockUseExecucaoRealtime.mockReturnValue({ execucao: undefined });
});

describe('GerarExecucao', () => {
  it('dispara a execução com competência + clienteId, sem seleções', async () => {
    vi.mocked(execucoesService.disparar).mockResolvedValue({ execucaoId: 'exec-1' });

    renderComProviders();
    await waitFor(() => expect(screen.getByText(/Clínica X/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Gerar execução/i }));

    await waitFor(() =>
      expect(execucoesService.disparar).toHaveBeenCalledWith(expect.any(String), [], undefined, 'cc-1', false),
    );
  });

  it('execução concluída com resultado ok mostra o valor e o botão de emitir', async () => {
    vi.mocked(execucoesService.disparar).mockResolvedValue({ execucaoId: 'exec-2' });
    mockUseExecucaoRealtime.mockReturnValue({
      execucao: { id: 'exec-2', status: 'concluido' },
    });
    vi.mocked(execucoesService.resultados).mockResolvedValue([
      {
        id: 'resultado-1',
        execucaoId: 'exec-2',
        medicoId: null,
        cpf: '',
        nome: 'Clínica X',
        procedimentos: null,
        cirurgias: null,
        guias: null,
        guiasConsolidado: null,
        subtotais: [],
        totalValor: 1200,
        status: 'ok',
        alertas: [],
        clienteContabilidadeId: 'cc-1',
      },
    ]);

    renderComProviders();
    fireEvent.click(screen.getByRole('button', { name: /Gerar execução/i }));

    await waitFor(() => expect(screen.getByText(/R\$ 1200.00/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Emitir boleto/i })).toBeInTheDocument();

    vi.mocked(boletosService.emitir).mockResolvedValue({} as any);
    fireEvent.click(screen.getByRole('button', { name: /Emitir boleto/i }));
    await waitFor(() => expect(boletosService.emitir).toHaveBeenCalledWith('resultado-1'));
  });

  it('execução concluída com resultado em alerta mostra o alerta, sem botão de emitir', async () => {
    vi.mocked(execucoesService.disparar).mockResolvedValue({ execucaoId: 'exec-3' });
    mockUseExecucaoRealtime.mockReturnValue({
      execucao: { id: 'exec-3', status: 'concluido' },
    });
    vi.mocked(execucoesService.resultados).mockResolvedValue([
      {
        id: 'resultado-2',
        execucaoId: 'exec-3',
        medicoId: null,
        cpf: '',
        nome: 'Clínica X',
        procedimentos: null,
        cirurgias: null,
        guias: null,
        guiasConsolidado: null,
        subtotais: [],
        totalValor: 0,
        status: 'alerta',
        alertas: ['Faturamento não lançado para a competência 2026-07 — lance antes de gerar o boleto.'],
        clienteContabilidadeId: 'cc-1',
      },
    ]);

    renderComProviders();
    fireEvent.click(screen.getByRole('button', { name: /Gerar execução/i }));

    await waitFor(() => expect(screen.getByText(/Faturamento não lançado/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Emitir boleto/i })).not.toBeInTheDocument();
  });

  it('cliente com adicional ativo mostra o toggle; sem bater o ciclo, começa desmarcado', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue({
      ...clienteFixo,
      adicionalAtivo: true,
      adicionalValor: 15000,
      adicionalIntervaloMeses: 6,
      adicionalCompetenciaBase: '2026-01',
    });
    vi.mocked(execucoesService.disparar).mockResolvedValue({ execucaoId: 'exec-4' });

    renderComProviders();
    await waitFor(() => expect(screen.getByText(/Gerar o adicional semestral/i)).toBeInTheDocument());

    // Competência que NÃO bate o ciclo (offset de 2 meses a partir de 2026-01, não múltiplo de 6).
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-03' } });
    const toggle = screen.getByRole('checkbox') as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(false));

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: /Gerar execução/i }));
    await waitFor(() =>
      expect(execucoesService.disparar).toHaveBeenCalledWith(expect.any(String), [], undefined, 'cc-1', true),
    );
  });

  it('competência que bate o ciclo pré-marca o toggle automaticamente', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue({
      ...clienteFixo,
      adicionalAtivo: true,
      adicionalValor: 15000,
      adicionalIntervaloMeses: 6,
      adicionalCompetenciaBase: '2026-01',
    });

    renderComProviders();
    await waitFor(() => expect(screen.getByText(/Gerar o adicional semestral/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText(/bate o ciclo do adicional semestral/i)).toBeInTheDocument();
  });
});
