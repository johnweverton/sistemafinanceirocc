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

// Inadimplência (BI gerencial, feedback da CEO 2026-08-17) reusa /recebiveis — mockado à parte
// dos outros 3 endpoints do dashboard, mesmo padrão.
const mockRecebiveis = vi.fn();
vi.mock('../../src/services/recebiveis', () => ({
  recebiveisService: { listar: (...a: unknown[]) => mockRecebiveis(...a) },
  recebiveisQueryKeys: { recebiveis: (f: unknown) => ['recebiveis', f] },
}));

// recharts usa ResizeObserver/getBoundingClientRect que jsdom não implementa — os gráficos em si
// não são o alvo destes testes (são só wrappers finos do lib/inadimplencia.ts, já testado à
// parte), então os componentes de gráfico são stubados para evitar ruído de layout no jsdom.
vi.mock('../../src/components/dashboard/EvolucaoMensalChart', () => ({
  EvolucaoMensalChart: () => <div data-testid="evolucao-chart-stub" />,
}));
vi.mock('../../src/components/dashboard/VencidoPorMedicoChart', () => ({
  VencidoPorMedicoChart: () => <div data-testid="vencido-chart-stub" />,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecebiveis.mockResolvedValue([]); // default: sem inadimplência, sobrescrito por teste quando relevante
  });

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

  it('BI gerencial (2026-08-17): mostra card de médico inadimplente e abre drill-down dos boletos vencidos ao clicar', async () => {
    mockComp.mockResolvedValue([
      { competencia: null, qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
      { competencia: '2026-06', qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
    ]);
    mockMed.mockResolvedValue([
      { medicoId: 'm1', nome: 'Dr. Alfa', qtdBoletos: 4, totalEmitido: 4000, totalRecebido: 2000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.25, ticketMedio: 1000 },
    ]);
    mockAging.mockResolvedValue([{ faixa: '0-30', qtd: 2, total: 900 }]);
    mockRecebiveis.mockResolvedValue([
      {
        boletoId: 'b1', execucaoResultadoId: 'e1', idExterno: null, competencia: '2026-06',
        medicoId: 'm1', nome: 'Dr. Alfa', valor: 1000, vencimento: '2026-06-10', pagoEm: null,
        valorPago: null, emitidoEm: '2026-06-01T00:00:00Z', contaEmissora: 'mc', statusDerivado: 'vencido',
      },
    ]);

    renderComProviders();

    await waitFor(() => expect(screen.getByText('Quem está inadimplente', { exact: false })).toBeInTheDocument());
    // Card agregado do médico — nome + total vencido.
    const card = await screen.findByRole('button', { name: /Dr\. Alfa/i });
    expect(card).toHaveTextContent('R$ 1.000,00');

    // Drill-down: clicar no card abre a tabela de boletos vencidos daquele médico.
    fireEvent.click(card);
    expect(await screen.findByText(/Boletos vencidos · Dr\. Alfa/)).toBeInTheDocument();
    // Vencimento do boleto do drill-down, formatado — único nessa tela (não colide com o select
    // de competência, que usa o formato AAAA-MM).
    expect(screen.getByText('10/06/2026')).toBeInTheDocument();

    // Clicar de novo fecha o drill-down.
    fireEvent.click(card);
    expect(screen.queryByText(/Boletos vencidos · Dr\. Alfa/)).not.toBeInTheDocument();
  });
});
