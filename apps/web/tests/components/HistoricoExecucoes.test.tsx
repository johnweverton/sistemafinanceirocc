// Teste do histórico de emissões (reorganização UX 2026-09-30): mês por extenso, resumo do mês,
// busca por nome/mês e filtro de serviço.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockListar = vi.fn();
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: { listar: (...a: unknown[]) => mockListar(...a) },
  execucaoQueryKeys: { execucoes: () => ['execucoes'] },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { HistoricoExecucoes } from '../../src/components/execucoes/HistoricoExecucoes';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HistoricoExecucoes />
    </QueryClientProvider>,
  );
}

const execucoes = [
  {
    id: 'e1', competencia: '2026-06', iniciadoPor: 'u1', iniciadoEm: '2026-06-01T10:00:00Z',
    finalizadoEm: '2026-06-01T10:05:00Z', status: 'concluido', progresso: 100,
    totalMedicos: 120, totalOk: 100, totalAlerta: 15, totalSemDados: 5, totalGeralValor: 50000,
  },
  {
    id: 'e2', competencia: '2026-06', iniciadoPor: 'u1', iniciadoEm: '2026-06-15T10:00:00Z',
    finalizadoEm: '2026-06-15T10:01:00Z', status: 'concluido', progresso: 100,
    totalMedicos: 1, totalOk: 1, totalAlerta: 0, totalSemDados: 0, totalGeralValor: 900,
    medicoNome: 'Dr. Beta',
  },
  {
    id: 'e4', competencia: '2026-06', iniciadoPor: 'u1', iniciadoEm: '2026-06-20T10:00:00Z',
    finalizadoEm: '2026-06-20T10:01:00Z', status: 'concluido', progresso: 100,
    totalMedicos: 3, totalOk: 3, totalAlerta: 0, totalSemDados: 0, totalGeralValor: 1500,
    clientesContabilidadeIds: ['c1', 'c2', 'c3'],
  },
  {
    id: 'e3', competencia: '2026-05', iniciadoPor: 'u1', iniciadoEm: '2026-05-01T10:00:00Z',
    finalizadoEm: null, status: 'erro', progresso: 40,
    totalMedicos: 118, totalOk: null, totalAlerta: null, totalSemDados: null, totalGeralValor: null,
  },
];

describe('HistoricoExecucoes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListar.mockResolvedValue(execucoes);
  });

  it('agrupa por mês por extenso, com resumo, e expande o mês mais recente', async () => {
    renderComProviders();
    const grupoJunho = await screen.findByRole('button', { name: /Junho de 2026/ });
    expect(within(grupoJunho).getByText('3 emissões')).toBeInTheDocument();
    expect(within(grupoJunho).getByText(/2 cobranças médicas · 1 de contabilidade/)).toBeInTheDocument();
    const cardJunho = grupoJunho.closest('div.card') as HTMLElement;
    expect(within(cardJunho).getByText('Lote do mês')).toBeInTheDocument();
    expect(within(cardJunho).getByText('Dr. Beta')).toBeInTheDocument();
    expect(within(cardJunho).getByText('Lote de contabilidade')).toBeInTheDocument();
    expect(within(cardJunho).getByText('100 ok · 15 a revisar · 5 sem produção')).toBeInTheDocument();
    // Mês mais antigo começa colapsado — a tabela não é renderizada.
    const grupoMaio = screen.getByRole('button', { name: /Maio de 2026/ });
    const cardMaio = grupoMaio.closest('div.card') as HTMLElement;
    expect(within(cardMaio).queryByRole('table')).not.toBeInTheDocument();
  });

  it('sinaliza no resumo o mês que tem emissão com erro', async () => {
    renderComProviders();
    const grupoMaio = await screen.findByRole('button', { name: /Maio de 2026/ });
    expect(within(grupoMaio).getByText('1 com erro')).toBeInTheDocument();
    fireEvent.click(grupoMaio);
    const cardMaio = grupoMaio.closest('div.card') as HTMLElement;
    await waitFor(() => expect(within(cardMaio).getByText('Erro')).toBeInTheDocument());
  });

  it('filtro de serviço Contabilidade deixa só as emissões contábeis', async () => {
    renderComProviders();
    await screen.findByRole('button', { name: /Junho de 2026/ });

    fireEvent.click(screen.getByRole('button', { name: 'Contabilidade' }));

    const grupoJunho = await screen.findByRole('button', { name: /Junho de 2026.*1 emissão/ });
    const cardJunho = grupoJunho.closest('div.card') as HTMLElement;
    expect(within(cardJunho).getByText('Lote de contabilidade')).toBeInTheDocument();
    expect(within(cardJunho).queryByText('Lote do mês')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Maio de 2026/ })).not.toBeInTheDocument();
  });

  it('busca pelo nome do mês filtra os grupos', async () => {
    renderComProviders();
    await screen.findByRole('button', { name: /Maio de 2026/ });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar médico, cliente ou mês' }), {
      target: { value: 'junho' },
    });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Maio de 2026/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Junho de 2026/ })).toBeInTheDocument();
  });

  it('busca por nome de médico deixa só a emissão individual dele', async () => {
    renderComProviders();
    await screen.findByRole('button', { name: /Maio de 2026/ });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar médico, cliente ou mês' }), {
      target: { value: 'beta' },
    });

    const grupoJunho = await screen.findByRole('button', { name: /Junho de 2026.*1 emissão/ });
    const cardJunho = grupoJunho.closest('div.card') as HTMLElement;
    expect(within(cardJunho).getByText('Dr. Beta')).toBeInTheDocument();
    expect(within(cardJunho).queryByText('Lote do mês')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Maio de 2026/ })).not.toBeInTheDocument();
  });

  it('mostra empty state quando não há emissões', async () => {
    mockListar.mockResolvedValue([]);
    renderComProviders();
    await waitFor(() =>
      expect(screen.getByText('Nenhuma emissão registrada ainda')).toBeInTheDocument(),
    );
  });
});
