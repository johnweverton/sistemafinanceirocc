// Teste de componente — DetalheCliente (Story 11.5 + reorganização UX 2026-07-24). Mocka o
// service (sem I/O) e envolve com QueryClientProvider (useQuery exige o contexto) — mesmo padrão
// de MedicoForm.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

vi.mock('../../src/services/clientes-contabilidade', () => ({
  clientesContabilidadeService: {
    detalhe: vi.fn(),
    historico: vi.fn(),
    listarFaturamentos: vi.fn(),
    execucoes: vi.fn(),
    atualizar: vi.fn(),
  },
  clienteContabilidadeQueryKeys: {
    clientes: () => ['clientes-contabilidade'] as const,
    cliente: (id: string) => ['clientes-contabilidade', id] as const,
    clienteHistorico: (id: string) => ['clientes-contabilidade', id, 'historico'] as const,
    clienteFaturamentos: (id: string) => ['clientes-contabilidade', id, 'faturamentos'] as const,
    clienteExecucoes: (id: string) => ['clientes-contabilidade', id, 'execucoes'] as const,
  },
}));

import { DetalheCliente } from '../../src/components/clientes-contabilidade/DetalheCliente';
import { clientesContabilidadeService } from '../../src/services/clientes-contabilidade';

function renderComQuery(clienteId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DetalheCliente clienteId={clienteId} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const clienteFaixaBase = {
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
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
};

beforeEach(() => {
  vi.mocked(clientesContabilidadeService.listarFaturamentos).mockResolvedValue([]);
  vi.mocked(clientesContabilidadeService.execucoes).mockResolvedValue([]);
  vi.mocked(clientesContabilidadeService.historico).mockResolvedValue([]);
});

describe('DetalheCliente', () => {
  it('mostra os dados cadastrais e a lista de execuções (mensal vs. adicional)', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue(clienteFaixaBase);
    vi.mocked(clientesContabilidadeService.execucoes).mockResolvedValue([
      {
        execucaoId: 'e1',
        competencia: '2026-07',
        execucaoStatus: 'concluido',
        statusResultado: 'ok',
        totalValor: 250,
        iniciadoEm: '2026-07-24T00:00:00Z',
        ehAdicional: false,
      },
    ]);

    renderComQuery('cc-1');

    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());
    expect(screen.getByText('Simples Nacional')).toBeInTheDocument();
    expect(screen.getByText('Faixa de faturamento')).toBeInTheDocument();
    expect(screen.getByText('Mensal')).toBeInTheDocument();
    // Story 12.2 (AC 5): era `R$ 250.00` (toFixed cru); agora passa pelo `brl()` pt-BR.
    expect(screen.getByText((t) => t.replace(/\s/g, ' ') === 'R$ 250,00')).toBeInTheDocument();
  });

  it('cliente fixo com regraPreco nunca alterada há mais de 12 meses mostra o aviso de reajuste', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue({
      ...clienteFaixaBase,
      modoCobranca: 'fixo',
      createdAt: '2020-01-01T00:00:00Z',
    });

    renderComQuery('cc-1');

    await waitFor(() => expect(screen.getByText(/Reajuste anual pendente/i)).toBeInTheDocument());
  });

  it('cliente faixa_faturamento (nunca precisa de reajuste manual) não mostra o aviso', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue({
      ...clienteFaixaBase,
      createdAt: '2020-01-01T00:00:00Z',
    });

    renderComQuery('cc-1');

    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());
    expect(screen.queryByText(/Reajuste anual pendente/i)).not.toBeInTheDocument();
  });

  it('a barra de ações mostra Emissão/Editar cadastro/Histórico em destaque (reorganização 2026-07-24; fluxo combinado 2026-07-30)', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue(clienteFaixaBase);

    renderComQuery('cc-1');

    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Emissão' })).toHaveAttribute('href', '/clientes-contabilidade/cc-1/execucao');
    expect(screen.getByRole('link', { name: 'Histórico' })).toHaveAttribute('href', '/clientes-contabilidade/cc-1/historico');
    expect(screen.getByRole('button', { name: 'Editar cadastro' })).toBeInTheDocument();
  });

  it('não mostra mais um link "Faturamento" separado na barra de ações (combinado dentro de Emissão, 2026-07-30)', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue(clienteFaixaBase);

    renderComQuery('cc-1');

    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Faturamento' })).not.toBeInTheDocument();
  });

  it('"Editar cadastro" abre o formulário inline; salvar chama o service e volta pra visão normal', async () => {
    vi.mocked(clientesContabilidadeService.detalhe).mockResolvedValue(clienteFaixaBase);
    vi.mocked(clientesContabilidadeService.atualizar).mockResolvedValue(clienteFaixaBase);

    renderComQuery('cc-1');

    await waitFor(() => expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Editar cadastro' }));

    // Formulário de cadastro aparece; a botão vira "Cancelar edição".
    expect(screen.getByRole('button', { name: 'Cancelar edição' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Nome do cliente/i })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: /Motivo da alteração/i }), {
      target: { value: 'Correção de teste' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar cliente/i }));

    await waitFor(() =>
      expect(clientesContabilidadeService.atualizar).toHaveBeenCalledWith(
        'cc-1',
        expect.objectContaining({ motivo: 'Correção de teste' }),
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar cadastro' })).toBeInTheDocument());
  });
});
