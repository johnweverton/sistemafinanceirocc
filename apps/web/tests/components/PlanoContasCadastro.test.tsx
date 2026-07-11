// Teste do cadastro do plano de contas + regras (Story 9.3) — services mockados.
// Chave: erro de negócio por código (CATEGORIA_SISTEMA_PROTEGIDA/EM_USO/INATIVA) vira
// toast explicando a causa, nunca uma mensagem genérica.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ApiClientError } from '../../src/lib/api-client';

const mockListarCategorias = vi.fn();
const mockCriarCategoria = vi.fn();
const mockAtualizarCategoria = vi.fn();
const mockDesativarCategoria = vi.fn();
const mockExcluirCategoria = vi.fn();
const mockListarRegras = vi.fn();
const mockCriarRegra = vi.fn();
const mockDesativarRegra = vi.fn();
const mockExcluirRegra = vi.fn();
vi.mock('../../src/services/plano-contas', () => ({
  planoContasService: {
    listarCategorias: (...a: unknown[]) => mockListarCategorias(...a),
    criarCategoria: (...a: unknown[]) => mockCriarCategoria(...a),
    atualizarCategoria: (...a: unknown[]) => mockAtualizarCategoria(...a),
    desativarCategoria: (...a: unknown[]) => mockDesativarCategoria(...a),
    excluirCategoria: (...a: unknown[]) => mockExcluirCategoria(...a),
    listarRegras: (...a: unknown[]) => mockListarRegras(...a),
    criarRegra: (...a: unknown[]) => mockCriarRegra(...a),
    desativarRegra: (...a: unknown[]) => mockDesativarRegra(...a),
    excluirRegra: (...a: unknown[]) => mockExcluirRegra(...a),
  },
  planoContasQueryKeys: {
    categorias: () => ['plano-contas', 'categorias'],
    regras: () => ['plano-contas', 'regras'],
  },
}));

import { PlanoContasCadastro } from '../../src/components/dre/PlanoContasCadastro';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PlanoContasCadastro />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const CATEGORIA_SISTEMA = { id: 'cat-sistema', grupo: 'receita', nome: 'Receita de honorários', sistema: true, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' };
const CATEGORIA_COMUM = { id: 'cat-comum', grupo: 'despesa_operacional', nome: 'Despesas administrativas', sistema: false, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  mockListarCategorias.mockResolvedValue([CATEGORIA_SISTEMA, CATEGORIA_COMUM]);
  mockListarRegras.mockResolvedValue([]);
});

// "Receita de honorários"/"Despesas administrativas" aparecem tanto na tabela quanto nas
// <option> do select de regras — as buscas precisam ser escopadas à tabela de categorias
// (única tabela renderizada enquanto a lista de regras está vazia).
async function tabelaCategorias() {
  return within(await screen.findByRole('table'));
}

describe('PlanoContasCadastro', () => {
  it('renderiza categorias com badge Sistema', async () => {
    renderComProviders();
    const tabela = await tabelaCategorias();
    expect(tabela.getByText('Receita de honorários')).toBeInTheDocument();
    expect(tabela.getByText('Sistema')).toBeInTheDocument();
  });

  it('cria categoria com grupo e nome informados', async () => {
    mockCriarCategoria.mockResolvedValue(CATEGORIA_COMUM);
    renderComProviders();
    await tabelaCategorias();

    fireEvent.change(screen.getByLabelText('Grupo da nova categoria'), { target: { value: 'despesa_financeira' } });
    fireEvent.change(screen.getByLabelText('Nome da nova categoria'), { target: { value: 'Juros' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar categoria' }));

    await waitFor(() =>
      expect(mockCriarCategoria).toHaveBeenCalledWith({ grupo: 'despesa_financeira', nome: 'Juros' }),
    );
  });

  it('excluir categoria em uso mostra o toast do CATEGORIA_EM_USO (não genérico)', async () => {
    mockExcluirCategoria.mockRejectedValue(
      new ApiClientError(409, 'Categoria em uso — desative em vez de excluir.', 'CATEGORIA_EM_USO'),
    );
    renderComProviders();
    const tabela = await tabelaCategorias();
    expect(tabela.getByText('Despesas administrativas')).toBeInTheDocument();

    const botoesExcluir = tabela.getAllByRole('button', { name: 'Excluir' });
    fireEvent.click(botoesExcluir[botoesExcluir.length - 1]!);

    await waitFor(() =>
      expect(screen.getByText(/Categoria em uso por transações ou lançamentos — desative/)).toBeInTheDocument(),
    );
  });

  it('categoria de sistema não mostra Desativar/Excluir (proteção na própria UI, QA-931-1)', async () => {
    renderComProviders();
    const tabela = await tabelaCategorias();
    const linhaSistema = tabela.getByText('Receita de honorários').closest('tr')!;
    const linhaComum = tabela.getByText('Despesas administrativas').closest('tr')!;
    expect(linhaSistema.textContent).not.toContain('Desativar');
    expect(linhaSistema.textContent).not.toContain('Excluir');
    expect(linhaComum.textContent).toContain('Desativar');
    expect(linhaComum.textContent).toContain('Excluir');
  });

  it('cria regra de categorização', async () => {
    mockCriarRegra.mockResolvedValue({
      id: 'r1', categoriaId: 'cat-comum', campo: 'descricao', padrao: 'aluguel', prioridade: 0, ativo: true, criadoEm: '2026-07-11T00:00:00Z',
    });
    renderComProviders();
    await tabelaCategorias();

    fireEvent.change(screen.getByLabelText('Categoria da nova regra'), { target: { value: 'cat-comum' } });
    fireEvent.change(screen.getByLabelText('Padrão da nova regra'), { target: { value: 'aluguel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar regra' }));

    await waitFor(() =>
      expect(mockCriarRegra).toHaveBeenCalledWith({
        categoriaId: 'cat-comum', campo: 'descricao', padrao: 'aluguel', prioridade: 0,
      }),
    );
  });
});
