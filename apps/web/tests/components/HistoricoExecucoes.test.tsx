// Teste da reforma de HistoricoExecucoes.tsx: busca, filtros e agrupamento por competência.
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

  it('agrupa por competência e expande o grupo mais recente por padrão', async () => {
    renderComProviders();
    const grupoJunho = await screen.findByRole('button', { name: /2026-06/ });
    expect(within(grupoJunho).getByText('2 execuções')).toBeInTheDocument();
    // Grupo mais recente (2026-06) já expandido: as 2 execuções aparecem na tabela (dentro do card).
    const cardJunho = grupoJunho.closest('div.card') as HTMLElement;
    expect(within(cardJunho).getByText('Em massa')).toBeInTheDocument();
    expect(within(cardJunho).getByText('Pontual')).toBeInTheDocument();
    // Grupo mais antigo (2026-05) começa colapsado — sua tabela não é renderizada.
    const grupoMaio = screen.getByRole('button', { name: /2026-05/ });
    const cardMaio = grupoMaio.closest('div.card') as HTMLElement;
    expect(within(cardMaio).queryByRole('table')).not.toBeInTheDocument();
  });

  it('expande um grupo colapsado ao clicar no cabeçalho', async () => {
    renderComProviders();
    const grupoMaio = await screen.findByRole('button', { name: /2026-05/ });
    fireEvent.click(grupoMaio);
    const cardMaio = grupoMaio.closest('div.card') as HTMLElement;
    await waitFor(() => expect(within(cardMaio).getByText('Erro')).toBeInTheDocument());
  });

  it('filtra por tipo pontual, deixando só a execução avulsa', async () => {
    renderComProviders();
    await screen.findByRole('button', { name: /2026-06/ });

    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por tipo' }), {
      target: { value: 'pontual' },
    });

    const grupoJunho = await screen.findByRole('button', { name: /2026-06.*1 execução/ });
    expect(within(grupoJunho).getByText('1 execução')).toBeInTheDocument();
    const cardJunho = grupoJunho.closest('div.card') as HTMLElement;
    expect(within(cardJunho).getByText('Pontual')).toBeInTheDocument();
    expect(within(cardJunho).queryByText('Em massa')).not.toBeInTheDocument();
    // O grupo de maio (só execução em massa) some da lista.
    expect(screen.queryByRole('button', { name: /2026-05/ })).not.toBeInTheDocument();
  });

  it('busca por competência filtra os grupos exibidos', async () => {
    renderComProviders();
    await screen.findByRole('button', { name: /2026-05/ });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar por competência' }), {
      target: { value: '2026-06' },
    });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /2026-05/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /2026-06/ })).toBeInTheDocument();
  });

  it('mostra empty state quando não há execuções', async () => {
    mockListar.mockResolvedValue([]);
    renderComProviders();
    await waitFor(() =>
      expect(screen.getByText('Nenhuma execução registrada ainda')).toBeInTheDocument(),
    );
  });
});
