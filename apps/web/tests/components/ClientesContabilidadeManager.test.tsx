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

  it('clicar em "Emissão" na linha não navega pro hub (link próprio, propagação interrompida)', async () => {
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());

    const linhaFaixa = screen.getByText('Padaria Bom Pão Ltda').closest('tr')!;
    const linkEmissao = Array.from(linhaFaixa.querySelectorAll('a')).find((a) => a.textContent === 'Emissão')!;
    fireEvent.click(linkEmissao);

    expect(mockPush).not.toHaveBeenCalled();
  });
});
