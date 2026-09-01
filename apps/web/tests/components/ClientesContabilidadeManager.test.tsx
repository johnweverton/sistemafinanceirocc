// Teste de componente — ClientesContabilidadeManager (reorganização UX 2026-07-24). Cobre: clique
// na linha navega pro hub de detalhe (não mais um modo "editar" inline), e as ações rápidas
// (Emissão/Faturamento) aparecem direto na linha. Mesmo padrão de mock de useRouter usado em
// HistoricoExecucoes.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('../../src/services/clientes-contabilidade', () => ({
  clientesContabilidadeService: {
    listar: vi.fn(),
    criar: vi.fn(),
    excluir: vi.fn(),
    excluirLote: vi.fn(),
    importar: vi.fn(),
  },
  clienteContabilidadeQueryKeys: {
    clientes: () => ['clientes-contabilidade'] as const,
  },
}));

import { ClientesContabilidadeManager } from '../../src/components/clientes-contabilidade/ClientesContabilidadeManager';
import { clientesContabilidadeService } from '../../src/services/clientes-contabilidade';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ClientesContabilidadeManager />
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

const clienteFixo = { ...clienteFaixa, id: 'cc-2', nome: 'Clínica X', modoCobranca: 'fixo' as const };
const clienteInativo = { ...clienteFaixa, id: 'cc-3', nome: 'Encerrado ME', ativo: false };

beforeEach(() => {
  mockPush.mockClear();
  vi.mocked(clientesContabilidadeService.listar).mockResolvedValue([clienteFaixa, clienteFixo]);
});

describe('ClientesContabilidadeManager', () => {
  it('clicar na linha navega para o hub de detalhe (não abre mais edição inline)', async () => {
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Padaria Bom Pão Ltda'));

    expect(mockPush).toHaveBeenCalledWith('/clientes-contabilidade/cc-1');
    // Não deve renderizar o formulário de cadastro — a edição agora vive só no hub.
    expect(screen.queryByRole('textbox', { name: /Nome do cliente/i })).not.toBeInTheDocument();
  });

  it('linha do cliente faixa_faturamento mostra só o atalho Emissão (fluxo combinado com faturamento, 2026-07-30)', async () => {
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());

    const linhaFaixa = screen.getByText('Padaria Bom Pão Ltda').closest('tr')!;
    expect(linhaFaixa).toHaveTextContent('Emissão');
    expect(linhaFaixa).not.toHaveTextContent('Faturamento');
  });

  it('linha do cliente fixo mostra o atalho Emissão', async () => {
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Clínica X')).toBeInTheDocument());

    const linhaFixo = screen.getByText('Clínica X').closest('tr')!;
    expect(linhaFixo).toHaveTextContent('Emissão');
    expect(linhaFixo).not.toHaveTextContent('Faturamento');
  });

  // Story 12.5 (AC 2, gap G-15): "10 selecionados" ao lado de "Calcular em lote (7)" sem
  // explicação era o gap; a diferença são os inativos e agora ela é dita na própria barra.
  it('AC 2: a barra de seleção explica a diferença entre selecionados e calculáveis', async () => {
    vi.mocked(clientesContabilidadeService.listar).mockResolvedValue([
      clienteFaixa,
      clienteFixo,
      clienteInativo,
    ]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Encerrado ME')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Selecionar todos os clientes'));

    const barra = screen.getByText(/3 selecionados/).closest('div')!;
    expect(barra.textContent?.replace(/\s+/g, ' ')).toContain(
      '3 selecionados · 1 inativo não entra no cálculo em lote',
    );
    expect(screen.getByRole('button', { name: /Calcular em lote \(2\)/ })).toBeInTheDocument();
  });

  it('AC 2: sem inativos selecionados a barra não ganha explicação nenhuma', async () => {
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Clínica X')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Selecionar todos os clientes'));

    expect(screen.getByText(/2 selecionados/).textContent).not.toContain('inativo');
    expect(screen.getByRole('button', { name: /Calcular em lote \(2\)/ })).toBeInTheDocument();
  });

  it('Story 11.1-A: cliente com vencimento em dia fixo mostra "Vence dia X" junto do nome', async () => {
    const clienteDiaFixo = {
      ...clienteFaixa,
      id: 'cc-4',
      nome: 'Contabilidade Vencimento Fixo',
      condicoes: {
        diasVencimento: null, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
        modoVencimento: 'dia_fixo' as const, diaFixoVencimento: 10,
      },
    };
    vi.mocked(clientesContabilidadeService.listar).mockResolvedValue([clienteFaixa, clienteDiaFixo]);
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Contabilidade Vencimento Fixo')).toBeInTheDocument());

    expect(screen.getByText('Vence dia 10')).toBeInTheDocument();
    // Cliente sem override não ganha o rótulo.
    const linhaFaixa = screen.getByText('Padaria Bom Pão Ltda').closest('tr')!;
    expect(linhaFaixa).not.toHaveTextContent('Vence dia');
  });

  it('clicar em "Emissão" na linha não navega pro hub (link próprio, propagação interrompida)', async () => {
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());

    const linhaFaixa = screen.getByText('Padaria Bom Pão Ltda').closest('tr')!;
    const linkEmissao = Array.from(linhaFaixa.querySelectorAll('a')).find((a) => a.textContent === 'Emissão')!;
    fireEvent.click(linkEmissao);

    expect(mockPush).not.toHaveBeenCalled();
  });
});
