// Teste do bloco de conciliação formal do período (melhoria pós-Épico 8/9, adaptação da
// skill `analisar-extrato-bancario`) — extrato ajustado por pendências × total já
// processado (conciliado) pelo sistema. Cálculo é leitura pura sobre as transações já
// carregadas + saldo atual da conta (mesma query do dashboard).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSaldos = vi.fn();
vi.mock('../../src/services/contas', () => ({
  contasService: { saldos: (...a: unknown[]) => mockSaldos(...a) },
  contasQueryKeys: { saldos: () => ['contas', 'saldos'] },
}));

import { ConciliacaoResumo } from '../../src/components/extrato/ConciliacaoResumo';

function renderComProviders(props: Parameters<typeof ConciliacaoResumo>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConciliacaoResumo {...props} />
    </QueryClientProvider>,
  );
}

const base = {
  entryId: 'e', transactionType: 'TRANSFER', descricao: null, contraparteNome: null,
  contraparteDocumento: null, dataTransacao: '2026-07-15T12:00:00Z', payload: {},
  contaEmissora: 'mc', boletoId: null, conciliadoPor: null, conciliadoEm: null,
  sincronizadoEm: '2026-07-15T13:00:00Z', categoriaId: null, statusCategorizacao: 'sem_categoria',
  categoria: null, boletoVinculado: null,
};

describe('ConciliacaoResumo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calcula créditos/débitos não conciliados, total conciliado e saldo ajustado', async () => {
    mockSaldos.mockResolvedValue([
      { conta: 'mc', nome: 'MC', configurada: true, saldo: { disponivel: 1000, bloqueado: null, consultadoEm: '2026-07-29T10:00:00Z' } },
    ]);
    const transacoes = [
      { ...base, id: 't1', tipo: 'CREDIT', valor: 300, statusConciliacao: 'sem_match' }, // + em trânsito
      { ...base, id: 't2', tipo: 'DEBIT', valor: 50, statusConciliacao: 'sugerido' }, // - em trânsito
      { ...base, id: 't3', tipo: 'CREDIT', valor: 500, statusConciliacao: 'conciliado_auto' }, // conciliado (+)
      { ...base, id: 't4', tipo: 'DEBIT', valor: 20, statusConciliacao: 'conciliado_manual' }, // conciliado (-)
      { ...base, id: 't5', tipo: 'DEBIT', valor: 999, statusConciliacao: 'ignorado' }, // fora dos dois cálculos
    ] as any;

    renderComProviders({ conta: 'mc', transacoes, periodo: { inicio: '2026-07-01', fim: '2026-07-29' } });

    await waitFor(() => expect(screen.getByText('Conciliação do período')).toBeInTheDocument());

    // Saldo atual da conta: R$ 1.000,00
    expect(screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 1.000,00')).toBeInTheDocument();
    // Créditos não conciliados: R$ 300,00
    expect(screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 300,00')).toBeInTheDocument();
    // Débitos não conciliados: R$ 50,00
    expect(screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 50,00')).toBeInTheDocument();
    // Saldo ajustado: 1000 + 300 - 50 = 1250,00
    expect(screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 1.250,00')).toBeInTheDocument();
    // Total conciliado: 500 - 20 = 480,00
    expect(screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 480,00')).toBeInTheDocument();
  });

  it('sem saldo disponível (conta não configurada) mostra travessão em vez de erro', async () => {
    mockSaldos.mockResolvedValue([{ conta: 'mc', nome: 'MC', configurada: false, saldo: null }]);
    renderComProviders({ conta: 'mc', transacoes: [], periodo: { inicio: '2026-07-01', fim: '2026-07-29' } });

    await waitFor(() => expect(screen.getByText('Conciliação do período')).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
