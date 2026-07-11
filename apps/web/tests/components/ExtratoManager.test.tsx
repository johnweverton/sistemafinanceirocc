// Teste do componente da página Extrato/Conciliação (Story 8.3) — services mockados +
// react-query + ToastProvider. Chaves do AC 5: sugestão confirmada dispara conciliar com o
// boletoId certo; filtro de empresa refaz a query; tarifas somadas no card; empty state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockListar = vi.fn();
const mockSincronizar = vi.fn();
const mockConciliar = vi.fn();
const mockIgnorar = vi.fn();
const mockDesfazer = vi.fn();
const mockBoletosConciliaveis = vi.fn();
const mockCategorizar = vi.fn();
vi.mock('../../src/services/extrato', () => ({
  extratoService: {
    listar: (...a: unknown[]) => mockListar(...a),
    sincronizar: (...a: unknown[]) => mockSincronizar(...a),
    conciliar: (...a: unknown[]) => mockConciliar(...a),
    ignorar: (...a: unknown[]) => mockIgnorar(...a),
    desfazer: (...a: unknown[]) => mockDesfazer(...a),
    boletosConciliaveis: (...a: unknown[]) => mockBoletosConciliaveis(...a),
    categorizar: (...a: unknown[]) => mockCategorizar(...a),
  },
  extratoQueryKeys: {
    extrato: (f: unknown) => ['extrato', f],
    boletosConciliaveis: (c: unknown) => ['extrato', 'boletos-conciliaveis', c],
  },
}));

const mockListarCategoriasAtivas = vi.fn();
vi.mock('../../src/services/plano-contas', () => ({
  planoContasService: { listarCategorias: (...a: unknown[]) => mockListarCategoriasAtivas(...a) },
  planoContasQueryKeys: { categorias: (ativo: unknown) => ['plano-contas', 'categorias', ativo] },
}));

import { ExtratoManager } from '../../src/components/extrato/ExtratoManager';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ExtratoManager />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const boletoPago = {
  boletoId: 'b1', execucaoResultadoId: 'r1', idExterno: 'inv_1', competencia: '2026-06',
  medicoId: 'm1', nome: 'Dr. Pago', valor: 1500, vencimento: '2026-07-01',
  pagoEm: '2026-06-15T12:00:00Z', valorPago: 1500, emitidoEm: '2026-06-01T00:00:00Z',
  contaEmissora: 'mc', statusDerivado: 'pago',
};

const base = {
  entryId: 'entry-1', transactionType: 'TRANSFER', descricao: 'TED recebida',
  contraparteNome: 'Dr. Pago', contraparteDocumento: '12345678900',
  dataTransacao: '2026-06-15T12:30:00Z', payload: {}, contaEmissora: 'mc',
  boletoId: null, conciliadoPor: null, conciliadoEm: null,
  sincronizadoEm: '2026-06-15T13:00:00Z',
  categoriaId: null, statusCategorizacao: 'sem_categoria', categoria: null,
};

const CATEGORIA_RECEITA = { id: 'cat-receita', grupo: 'receita', nome: 'Receita de honorários', sistema: true, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' };
const CATEGORIA_ALUGUEL = { id: 'cat-aluguel', grupo: 'despesa_operacional', nome: 'Despesas administrativas', sistema: false, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' };

const sugerida = {
  ...base, id: 't-sugerida', tipo: 'CREDIT', valor: 1500,
  statusConciliacao: 'sugerido', boletoId: 'b1', boletoVinculado: boletoPago,
};
const semMatch = {
  ...base, id: 't-sem-match', entryId: 'entry-2', tipo: 'CREDIT', valor: 900,
  statusConciliacao: 'sem_match', boletoVinculado: null,
};

const totais = { creditos: 2400, debitos: 310.5, tarifas: 12.9 };

describe('ExtratoManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListarCategoriasAtivas.mockResolvedValue([CATEGORIA_RECEITA, CATEGORIA_ALUGUEL]);
  });

  it('fila de sugestões: Confirmar chama conciliar com a transação e o boletoId certos', async () => {
    mockListar.mockResolvedValue({ transacoes: [sugerida, semMatch], totais });
    mockConciliar.mockResolvedValue({ transacao: { ...sugerida, statusConciliacao: 'conciliado_manual' } });
    renderComProviders();

    await waitFor(() => expect(screen.getByText(/Sugestões de conciliação/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(mockConciliar).toHaveBeenCalledWith('t-sugerida', 'b1'));
  });

  it('filtro por empresa refaz a query com a conta selecionada', async () => {
    mockListar.mockResolvedValue({ transacoes: [semMatch], totais });
    renderComProviders();
    await waitFor(() => expect(mockListar).toHaveBeenCalledWith(expect.objectContaining({ conta: 'mc' })));

    fireEvent.change(screen.getByRole('combobox', { name: 'Empresa' }), {
      target: { value: 'cavalcante_viana' },
    });
    await waitFor(() =>
      expect(mockListar).toHaveBeenCalledWith(expect.objectContaining({ conta: 'cavalcante_viana' })),
    );
  });

  it('card de totais mostra recebido, saídas e tarifas do período', async () => {
    mockListar.mockResolvedValue({ transacoes: [semMatch], totais });
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Tarifas bancárias')).toBeInTheDocument());
    expect(screen.getByText('Recebido no período')).toBeInTheDocument();
    expect(screen.getByText('Saídas no período')).toBeInTheDocument();
    // Valores em BRL (NBSP entre R$ e o número).
    expect(screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 12,90')).toBeInTheDocument();
    expect(screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 2.400,00')).toBeInTheDocument();
  });

  it('empty state orienta a sincronizar quando não há transações', async () => {
    mockListar.mockResolvedValue({ transacoes: [], totais: { creditos: 0, debitos: 0, tarifas: 0 } });
    renderComProviders();

    await waitFor(() =>
      expect(screen.getByText('Nenhuma transação no período')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Sincronize o extrato de MC/)).toBeInTheDocument();
  });

  it('ações por linha: sem_match tem Vincular/Ignorar; conciliada tem Desfazer', async () => {
    const conciliada = {
      ...base, id: 't-conciliada', entryId: 'entry-3', tipo: 'CREDIT', valor: 700,
      statusConciliacao: 'conciliado_auto', boletoId: 'b1', boletoVinculado: boletoPago,
    };
    mockListar.mockResolvedValue({ transacoes: [semMatch, conciliada], totais });
    renderComProviders();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const tabela = screen.getByRole('table');
    expect(within(tabela).getByRole('button', { name: 'Vincular' })).toBeInTheDocument();
    expect(within(tabela).getByRole('button', { name: 'Ignorar' })).toBeInTheDocument();
    expect(within(tabela).getByRole('button', { name: 'Desfazer' })).toBeInTheDocument();
  });

  it('coluna Categoria mostra o badge certo por statusCategorizacao (Story 9.3)', async () => {
    const confirmada = {
      ...base, id: 't-confirmada', entryId: 'entry-4', tipo: 'CREDIT', valor: 1500,
      statusConciliacao: 'conciliado_auto', categoriaId: 'cat-receita',
      statusCategorizacao: 'confirmada', categoria: CATEGORIA_RECEITA,
    };
    const sugeridaCategoria = {
      ...semMatch, id: 't-sug-cat', entryId: 'entry-5',
      categoriaId: 'cat-aluguel', statusCategorizacao: 'sugerida', categoria: CATEGORIA_ALUGUEL,
    };
    mockListar.mockResolvedValue({ transacoes: [confirmada, sugeridaCategoria, semMatch], totais });
    renderComProviders();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText('Receita de honorários')).toBeInTheDocument();
    expect(screen.getByText(/Sugestão: Despesas administrativas/)).toBeInTheDocument();
    expect(screen.getByText('Sem categoria')).toBeInTheDocument();
  });

  it('sugerida: Confirmar chama categorizar com o categoriaId sugerido', async () => {
    const sugeridaCategoria = {
      ...semMatch, id: 't-sug-cat', entryId: 'entry-5',
      categoriaId: 'cat-aluguel', statusCategorizacao: 'sugerida', categoria: CATEGORIA_ALUGUEL,
    };
    mockListar.mockResolvedValue({ transacoes: [sugeridaCategoria], totais });
    mockCategorizar.mockResolvedValue({ transacao: sugeridaCategoria });
    renderComProviders();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mockCategorizar).toHaveBeenCalledWith('t-sug-cat', 'cat-aluguel'));
  });

  it('confirmada não tem ação de categorizar; sem_categoria tem "Categorizar"', async () => {
    const confirmada = {
      ...base, id: 't-confirmada', entryId: 'entry-4', tipo: 'CREDIT', valor: 1500,
      statusConciliacao: 'conciliado_auto', categoriaId: 'cat-receita',
      statusCategorizacao: 'confirmada', categoria: CATEGORIA_RECEITA,
    };
    mockListar.mockResolvedValue({ transacoes: [confirmada, semMatch], totais });
    renderComProviders();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const linhaConfirmada = screen.getByText('Receita de honorários').closest('tr')!;
    expect(within(linhaConfirmada).queryByRole('button', { name: 'Categorizar' })).toBeNull();
    const linhaSemCategoria = screen.getByText('Sem categoria').closest('tr')!;
    expect(within(linhaSemCategoria).getByRole('button', { name: 'Categorizar' })).toBeInTheDocument();
  });

  it('diálogo de categorização: escolhe uma categoria e chama categorizar', async () => {
    mockListar.mockResolvedValue({ transacoes: [semMatch], totais });
    mockCategorizar.mockResolvedValue({ transacao: semMatch });
    renderComProviders();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Categorizar' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Categorizar transação' });
    fireEvent.click(within(dialogo).getByText('Despesas administrativas'));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Categorizar' }));

    await waitFor(() =>
      expect(mockCategorizar).toHaveBeenCalledWith('t-sem-match', 'cat-aluguel'),
    );
  });
});
