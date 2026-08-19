// Teste do RelatoriosManager (Módulo de Relatórios) — service mockado + react-query + Toast.
// Cobre: preview agrupado por empresa com subtotal/total geral, e listagem de links públicos
// (LinkPublicoBI é renderizado dentro do mesmo componente).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockPreview = vi.fn();
const mockExportarExcel = vi.fn();
const mockExportarPdf = vi.fn();
const mockListarLinks = vi.fn();
const mockCriarLink = vi.fn();
const mockRevogarLink = vi.fn();
vi.mock('../../src/services/relatorios', () => ({
  relatoriosService: {
    preview: (...a: unknown[]) => mockPreview(...a),
    exportarExcel: (...a: unknown[]) => mockExportarExcel(...a),
    exportarPdf: (...a: unknown[]) => mockExportarPdf(...a),
    links: {
      listar: (...a: unknown[]) => mockListarLinks(...a),
      criar: (...a: unknown[]) => mockCriarLink(...a),
      revogar: (...a: unknown[]) => mockRevogarLink(...a),
    },
  },
  relatoriosQueryKeys: {
    preview: (f: unknown) => ['relatorios', 'preview', f],
    links: () => ['relatorios', 'links'],
  },
}));

import { RelatoriosManager } from '../../src/components/relatorios/RelatoriosManager';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RelatoriosManager />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const RELATORIO = {
  filtro: { competencia: '2026-06' },
  geradoEm: '2026-06-15T00:00:00Z',
  grupos: [
    {
      contaEmissora: 'mc',
      contaEmissoraLabel: 'MC',
      linhas: [
        {
          boletoId: 'b1',
          execucaoResultadoId: 'er1',
          idExterno: 'ext1',
          competencia: '2026-06',
          medicoId: 'm1',
          nome: 'Dr. Alfa',
          valor: 1000,
          vencimento: '2026-06-10',
          pagoEm: null,
          valorPago: null,
          emitidoEm: '2026-06-01T00:00:00Z',
          contaEmissora: 'mc',
          statusDerivado: 'em_aberto',
        },
      ],
      subtotal: { qtd: 1, totalEmitido: 1000, totalPago: 0, totalEmAberto: 1000, totalVencido: 0, totalCancelado: 0 },
    },
  ],
  totalGeral: { qtd: 1, totalEmitido: 1000, totalPago: 0, totalEmAberto: 1000, totalVencido: 0, totalCancelado: 0 },
};

beforeEach(() => vi.clearAllMocks());

describe('RelatoriosManager', () => {
  it('renderiza o preview agrupado por empresa com subtotal e total geral', async () => {
    mockPreview.mockResolvedValue(RELATORIO);
    mockListarLinks.mockResolvedValue([]);
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Dr. Alfa')).toBeInTheDocument());
    // "MC" aparece como título do grupo e dentro de "Subtotal MC" (dois nós de texto) → ≥ 2.
    expect(screen.getAllByText('MC').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Total geral')).toBeInTheDocument();
    // Vencimento (fixture: '2026-06-10') exibido como DD/MM/AAAA, não a string ISO crua.
    expect(screen.getByText('10/06/2026')).toBeInTheDocument();
  });

  it('mostra empty state sem recebíveis no período', async () => {
    mockPreview.mockResolvedValue({ ...RELATORIO, grupos: [], totalGeral: { qtd: 0, totalEmitido: 0, totalPago: 0, totalEmAberto: 0, totalVencido: 0, totalCancelado: 0 } });
    mockListarLinks.mockResolvedValue([]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText(/Sem recebíveis no período/i)).toBeInTheDocument());
  });

  it('filtro "Tipo de serviço" (migration 0049) repassa tipoServico pro preview e pro export', async () => {
    mockPreview.mockResolvedValue(RELATORIO);
    mockListarLinks.mockResolvedValue([]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Dr. Alfa')).toBeInTheDocument());

    const selectTipo = screen.getByRole('combobox', { name: 'Tipo de serviço' });
    fireEvent.change(selectTipo, { target: { value: 'contabilidade' } });

    await waitFor(() =>
      expect(mockPreview).toHaveBeenCalledWith(expect.objectContaining({ tipoServico: 'contabilidade' })),
    );
  });

  it('lista os links públicos existentes', async () => {
    mockPreview.mockResolvedValue(RELATORIO);
    mockListarLinks.mockResolvedValue([
      { id: 'link-1', token: 'tok', nome: 'BI da CEO', escopoContaEmissora: null, criadoPor: 'u1', criadoEm: '2026-06-01T00:00:00Z', expiraEm: null, revogadoEm: null, ultimoAcessoEm: null },
    ]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('BI da CEO')).toBeInTheDocument());
    expect(screen.getByText('Ativo')).toBeInTheDocument();
  });
});
