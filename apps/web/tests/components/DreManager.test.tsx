// Teste do componente do relatório DRE (Story 9.3) — services mockados + react-query +
// ToastProvider. Chaves: resultado líquido positivo/negativo, criação de lançamento
// avulso/recorrente com o payload certo, filtro de empresa refaz a query do relatório.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockRelatorio = vi.fn();
const mockListarLancamentos = vi.fn();
const mockCriarLancamento = vi.fn();
const mockExcluirLancamento = vi.fn();
vi.mock('../../src/services/dre', () => ({
  dreService: {
    relatorio: (...a: unknown[]) => mockRelatorio(...a),
    listarLancamentos: (...a: unknown[]) => mockListarLancamentos(...a),
    criarLancamento: (...a: unknown[]) => mockCriarLancamento(...a),
    excluirLancamento: (...a: unknown[]) => mockExcluirLancamento(...a),
  },
  dreQueryKeys: {
    relatorio: (f: unknown) => ['dre', 'relatorio', f],
    lancamentos: (c: unknown) => ['dre', 'lancamentos', c],
  },
}));

const mockListarCategorias = vi.fn();
vi.mock('../../src/services/plano-contas', () => ({
  planoContasService: { listarCategorias: (...a: unknown[]) => mockListarCategorias(...a) },
  planoContasQueryKeys: { categorias: (ativo: unknown) => ['plano-contas', 'categorias', ativo] },
}));

import { DreManager } from '../../src/components/dre/DreManager';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DreManager />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const CATEGORIA_RECEITA = { id: 'cat-receita', grupo: 'receita', nome: 'Receita de honorários', sistema: true, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' };
const CATEGORIA_ALUGUEL = { id: 'cat-aluguel', grupo: 'despesa_operacional', nome: 'Despesas administrativas', sistema: false, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' };

const RELATORIO_POSITIVO = {
  porCategoria: [
    { categoriaId: 'cat-receita', nome: 'Receita de honorários', grupo: 'receita', total: 10000 },
    { categoriaId: 'cat-aluguel', nome: 'Despesas administrativas', grupo: 'despesa_operacional', total: 2000 },
  ],
  totalReceitas: 10000,
  totalDeducoes: 0,
  totalDespesasOperacionais: 2000,
  totalDespesasFinanceiras: 0,
  resultadoLiquido: 8000,
};

const LANCAMENTO_AVULSO = {
  id: 'l1', contaEmissora: 'mc', categoriaId: 'cat-aluguel', descricao: 'Reforma', valor: 500,
  tipoLancamento: 'avulso', data: '2026-07-05', diaDoMes: null, dataInicio: null, dataFim: null,
  criadoPor: 'u1', criadoEm: '2026-07-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListarCategorias.mockResolvedValue([CATEGORIA_RECEITA, CATEGORIA_ALUGUEL]);
  mockListarLancamentos.mockResolvedValue([]);
});

describe('DreManager', () => {
  it('renderiza o resultado líquido positivo em verde e os grupos com seus totais', async () => {
    mockRelatorio.mockResolvedValue(RELATORIO_POSITIVO);
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Resultado líquido')).toBeInTheDocument());
    expect(screen.getByText('Receitas')).toBeInTheDocument();
    expect(screen.getByText('Despesas Operacionais')).toBeInTheDocument();
    expect(screen.getByText('Receita de honorários')).toBeInTheDocument();
    const resultado = screen.getByText((t) => t.replace(/ /g, ' ') === 'R$ 8.000,00');
    expect(resultado).toBeInTheDocument();
    expect(resultado.className).toContain('text-cc-success');
  });

  it('resultado líquido negativo aparece em vermelho', async () => {
    mockRelatorio.mockResolvedValue({ ...RELATORIO_POSITIVO, resultadoLiquido: -500 });
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Resultado líquido')).toBeInTheDocument());
    const resultado = screen.getByText((t) => t.replace(/ /g, ' ') === '-R$ 500,00');
    expect(resultado.className).toContain('text-cc-danger');
  });

  it('empty state quando não há transações nem lançamentos no período', async () => {
    mockRelatorio.mockResolvedValue({
      porCategoria: [], totalReceitas: 0, totalDeducoes: 0,
      totalDespesasOperacionais: 0, totalDespesasFinanceiras: 0, resultadoLiquido: 0,
    });
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Sem dados no período')).toBeInTheDocument());
  });

  it('filtro de empresa refaz a query do relatório e dos lançamentos', async () => {
    mockRelatorio.mockResolvedValue(RELATORIO_POSITIVO);
    renderComProviders();
    await waitFor(() => expect(mockRelatorio).toHaveBeenCalledWith(expect.objectContaining({ conta: undefined })));

    fireEvent.change(screen.getByRole('combobox', { name: 'Empresa' }), { target: { value: 'mc' } });
    await waitFor(() => expect(mockRelatorio).toHaveBeenCalledWith(expect.objectContaining({ conta: 'mc' })));
    expect(mockListarLancamentos).toHaveBeenCalledWith('mc');
  });

  it('lista lançamentos manuais com o nome da categoria resolvido', async () => {
    mockRelatorio.mockResolvedValue(RELATORIO_POSITIVO);
    mockListarLancamentos.mockResolvedValue([LANCAMENTO_AVULSO]);
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Reforma')).toBeInTheDocument());
    const tabela = screen.getAllByRole('table')[0]!;
    expect(within(tabela).getByText('Despesas administrativas')).toBeInTheDocument();
  });

  it('lançamento de categoria DESATIVADA ainda mostra o nome (QA-931-1)', async () => {
    mockRelatorio.mockResolvedValue(RELATORIO_POSITIVO);
    mockListarLancamentos.mockResolvedValue([{ ...LANCAMENTO_AVULSO, categoriaId: 'cat-antiga' }]);
    // listarCategorias() sem filtro (lista completa) inclui a categoria já desativada.
    mockListarCategorias.mockResolvedValue([
      CATEGORIA_RECEITA,
      CATEGORIA_ALUGUEL,
      { id: 'cat-antiga', grupo: 'despesa_operacional', nome: 'Categoria antiga', sistema: false, ativo: false, ordem: 0, criadoEm: '2026-01-01T00:00:00Z' },
    ]);
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Reforma')).toBeInTheDocument());
    const tabela = screen.getAllByRole('table')[0]!;
    expect(within(tabela).getByText('Categoria antiga')).toBeInTheDocument();
  });

  it('cria lançamento avulso com o payload certo', async () => {
    mockRelatorio.mockResolvedValue(RELATORIO_POSITIVO);
    mockCriarLancamento.mockResolvedValue(LANCAMENTO_AVULSO);
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Resultado líquido')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Novo lançamento' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Novo lançamento manual' });
    fireEvent.change(within(dialogo).getByLabelText('Categoria'), { target: { value: 'cat-aluguel' } });
    fireEvent.change(within(dialogo).getByLabelText('Descrição'), { target: { value: 'Reforma' } });
    fireEvent.change(within(dialogo).getByLabelText('Valor'), { target: { value: '500' } });
    fireEvent.change(within(dialogo).getByLabelText('Data'), { target: { value: '2026-07-05' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar lançamento' }));

    await waitFor(() =>
      expect(mockCriarLancamento).toHaveBeenCalledWith(
        expect.objectContaining({
          tipoLancamento: 'avulso',
          categoriaId: 'cat-aluguel',
          descricao: 'Reforma',
          valor: 500,
          data: '2026-07-05',
        }),
      ),
    );
  });

  it('cria lançamento recorrente com o payload certo (diaDoMes/dataInicio)', async () => {
    mockRelatorio.mockResolvedValue(RELATORIO_POSITIVO);
    mockCriarLancamento.mockResolvedValue({ ...LANCAMENTO_AVULSO, tipoLancamento: 'recorrente' });
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Resultado líquido')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Novo lançamento' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Novo lançamento manual' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Recorrente' }));
    fireEvent.change(within(dialogo).getByLabelText('Categoria'), { target: { value: 'cat-aluguel' } });
    fireEvent.change(within(dialogo).getByLabelText('Descrição'), { target: { value: 'Aluguel' } });
    fireEvent.change(within(dialogo).getByLabelText('Valor'), { target: { value: '2000' } });
    fireEvent.change(within(dialogo).getByLabelText('Dia do mês'), { target: { value: '5' } });
    fireEvent.change(within(dialogo).getByLabelText('Início da recorrência'), { target: { value: '2026-07-01' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar lançamento' }));

    await waitFor(() =>
      expect(mockCriarLancamento).toHaveBeenCalledWith(
        expect.objectContaining({
          tipoLancamento: 'recorrente',
          diaDoMes: 5,
          dataInicio: '2026-07-01',
          dataFim: null,
        }),
      ),
    );
  });

  it('excluir lançamento chama o service com o id certo', async () => {
    mockRelatorio.mockResolvedValue(RELATORIO_POSITIVO);
    mockListarLancamentos.mockResolvedValue([LANCAMENTO_AVULSO]);
    mockExcluirLancamento.mockResolvedValue(undefined);
    renderComProviders();

    await waitFor(() => expect(screen.getByText('Reforma')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(mockExcluirLancamento).toHaveBeenCalledWith('l1'));
  });
});
