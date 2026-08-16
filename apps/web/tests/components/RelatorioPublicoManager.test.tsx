// Teste do RelatorioPublicoManager (BI público, Módulo de Relatórios) — service mockado.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockBuscar = vi.fn();
vi.mock('../../src/services/relatorios-publico', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/relatorios-publico')>(
    '../../src/services/relatorios-publico',
  );
  return {
    ...actual,
    relatoriosPublicoService: { buscar: (...a: unknown[]) => mockBuscar(...a) },
    relatoriosPublicoQueryKeys: { resposta: (t: string, c?: string) => ['relatorios-publico', t, c ?? null] },
  };
});

import { RelatorioPublicoManager } from '../../src/components/relatorios/RelatorioPublicoManager';
import { RelatorioPublicoIndisponivel } from '../../src/services/relatorios-publico';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RelatorioPublicoManager token="tok-ok" />
    </QueryClientProvider>,
  );
}

const RESPOSTA = {
  nomeLink: 'BI da CEO',
  escopoContaEmissora: null,
  competenciasDisponiveis: ['2026-06'],
  kpi: { competencia: null, qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
  evolucaoMensal: [
    { competencia: '2026-06', qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
  ],
  porEmpresa: [{ contaEmissora: 'mc', contaEmissoraLabel: 'MC', totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000 }],
  aging: [{ faixa: '0-30', qtd: 2, total: 900 }],
  geradoEm: '2026-06-15T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('RelatorioPublicoManager', () => {
  it('renderiza KPIs, por empresa, evolução mensal e aging', async () => {
    mockBuscar.mockResolvedValue(RESPOSTA);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('BI da CEO')).toBeInTheDocument());
    expect(screen.getAllByText('MC').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Evolução mensal')).toBeInTheDocument();
    expect(screen.getByText(/Aging de vencidos/)).toBeInTheDocument();
  });

  it('mostra mensagem amigável quando o link é inválido/revogado (404)', async () => {
    mockBuscar.mockRejectedValue(new RelatorioPublicoIndisponivel('Link inválido, revogado ou expirado.'));
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Link indisponível')).toBeInTheDocument());
  });

  it('nunca renderiza um select de ações de mutação (é só leitura)', async () => {
    mockBuscar.mockResolvedValue(RESPOSTA);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('BI da CEO')).toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
