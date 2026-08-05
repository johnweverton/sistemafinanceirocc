// Teste do Dashboard financeiro (Story 4.6 + fix 0010 + filtro conta emissora 0042) — service
// mockado + react-query. Após a migration 0010, medicos/aging recebem competencia e os KPIs usam
// a linha de rollup do banco. Após a 0042, as 3 chamadas também recebem contaEmissora.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockComp = vi.fn();
const mockMed = vi.fn();
const mockAging = vi.fn();
vi.mock('../../src/services/dashboard', () => ({
  dashboardService: {
    competencias: (...a: unknown[]) => mockComp(...a),
    medicos: (...a: unknown[]) => mockMed(...a),
    aging: (...a: unknown[]) => mockAging(...a),
  },
  dashboardQueryKeys: {
    competencias: (conta?: string) => ['dashboard', 'competencias', conta ?? null],
    medicos: (c?: string, conta?: string) => ['dashboard', 'medicos', c ?? null, conta ?? null],
    aging: (c?: string, conta?: string) => ['dashboard', 'aging', c ?? null, conta ?? null],
  },
}));

import { DashboardManager } from '../../src/components/dashboard/DashboardManager';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardManager />
    </QueryClientProvider>,
  );
}

describe('DashboardManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderiza KPIs (via rollup), aging e tabela por médico', async () => {
    mockComp.mockResolvedValue([
      // Linha de rollup (total geral) — competencia null
      { competencia: null, qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
      // Linha por competência
      { competencia: '2026-06', qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
    ]);
    mockMed.mockResolvedValue([
      { medicoId: 'm1', nome: 'Dr. Alfa', qtdBoletos: 4, totalEmitido: 4000, totalRecebido: 2000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.25, ticketMedio: 1000 },
    ]);
    mockAging.mockResolvedValue([{ faixa: '0-30', qtd: 2, total: 900 }]);

    renderComProviders();

    // KPIs — usar labels que não colidem com os headers da tabela por médico.
    await waitFor(() => expect(screen.getByText('Em aberto')).toBeInTheDocument());
    expect(screen.getByText('Inadimplência')).toBeInTheDocument();
    // "Emitido" aparece no KPI e no header da tabela → deve haver ≥ 2 ocorrências.
    expect(screen.getAllByText('Emitido').length).toBeGreaterThanOrEqual(2);
    // Aging
    expect(screen.getByText(/0-30 dias/)).toBeInTheDocument();
    // Tabela por médico
    await waitFor(() => expect(screen.getByText('Dr. Alfa')).toBeInTheDocument());
  });

  it('mostra empty state sem competências', async () => {
    mockComp.mockResolvedValue([]);
    mockMed.mockResolvedValue([]);
    mockAging.mockResolvedValue([]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText(/Sem dados financeiros ainda/i)).toBeInTheDocument());
  });

  it('troca de conta emissora dispara as 3 chamadas com o filtro selecionado', async () => {
    mockComp.mockResolvedValue([
      { competencia: null, qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
      { competencia: '2026-06', qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
    ]);
    mockMed.mockResolvedValue([
      { medicoId: 'm1', nome: 'Dr. Alfa', qtdBoletos: 4, totalEmitido: 4000, totalRecebido: 2000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.25, ticketMedio: 1000 },
    ]);
    mockAging.mockResolvedValue([{ faixa: '0-30', qtd: 2, total: 900 }]);

    renderComProviders();
    await waitFor(() => expect(screen.getByText('Dr. Alfa')).toBeInTheDocument());

    const selectConta = screen.getByRole('combobox', { name: 'Filtrar por conta emissora' });
    fireEvent.change(selectConta, { target: { value: 'cavalcante_viana' } });

    await waitFor(() => expect(mockComp).toHaveBeenCalledWith(undefined, 'cavalcante_viana'));
    expect(mockMed).toHaveBeenCalledWith(undefined, 'cavalcante_viana');
    expect(mockAging).toHaveBeenCalledWith(undefined, 'cavalcante_viana');
  });
});
