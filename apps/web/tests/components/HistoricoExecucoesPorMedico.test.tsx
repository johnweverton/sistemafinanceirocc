// Teste da visão "Por médico" (Fase 3): tabela-resumo + drill-down lazy por linha.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockResumoPorMedico = vi.fn();
const mockHistoricoMedico = vi.fn();
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: {
    resumoPorMedico: (...a: unknown[]) => mockResumoPorMedico(...a),
    historicoMedico: (...a: unknown[]) => mockHistoricoMedico(...a),
  },
  execucaoQueryKeys: {
    resumoPorMedico: () => ['execucoes', 'por-medico'],
    historicoMedico: (chave: string) => ['execucoes', 'por-medico', 'historico', chave],
  },
}));

import { HistoricoExecucoesPorMedico } from '../../src/components/execucoes/HistoricoExecucoesPorMedico';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HistoricoExecucoesPorMedico />
    </QueryClientProvider>,
  );
}

const resumo = [
  {
    medicoId: 'm1', cpf: '11111111111', nome: 'Dr. Teste',
    ultimaCompetencia: '2026-06', ultimaExecucaoId: 'e1', ultimaExecucaoStatus: 'concluido',
    ultimoStatusResultado: 'ok', ultimoValor: 950.89, qtdExecucoes: 3,
  },
  {
    medicoId: null, cpf: '22222222222', nome: 'Dra. Sem Cadastro',
    ultimaCompetencia: '2026-05', ultimaExecucaoId: 'e2', ultimaExecucaoStatus: 'concluido',
    ultimoStatusResultado: 'alerta', ultimoValor: 100, qtdExecucoes: 1,
  },
];

describe('HistoricoExecucoesPorMedico', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResumoPorMedico.mockResolvedValue(resumo);
    mockHistoricoMedico.mockResolvedValue([]);
  });

  it('lista um médico por linha com status e valor', async () => {
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Dr. Teste')).toBeInTheDocument());
    expect(screen.getByText('Dra. Sem Cadastro')).toBeInTheDocument();
    expect(screen.getByText('Ok')).toBeInTheDocument();
    expect(screen.getByText('Alerta')).toBeInTheDocument();
    expect(screen.getByText('2 médicos')).toBeInTheDocument();
  });

  it('busca filtra por nome ou CPF', async () => {
    renderComProviders();
    await waitFor(() => expect(screen.getByText('Dr. Teste')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar médico por nome ou CPF' }), {
      target: { value: 'sem cadastro' },
    });

    await waitFor(() => expect(screen.queryByText('Dr. Teste')).not.toBeInTheDocument());
    expect(screen.getByText('Dra. Sem Cadastro')).toBeInTheDocument();
  });

  it('expande uma linha e busca o histórico via medicoId', async () => {
    mockHistoricoMedico.mockResolvedValue([
      { execucaoId: 'e1', competencia: '2026-06', execucaoStatus: 'concluido', statusResultado: 'ok', totalValor: 950.89, iniciadoEm: '2026-06-01T10:00:00Z' },
      { execucaoId: 'e0', competencia: '2026-05', execucaoStatus: 'concluido', statusResultado: 'alerta', totalValor: 800, iniciadoEm: '2026-05-01T10:00:00Z' },
    ]);
    renderComProviders();
    const linha = await screen.findByText('Dr. Teste');
    fireEvent.click(linha.closest('tr') as HTMLElement);

    await waitFor(() => expect(mockHistoricoMedico).toHaveBeenCalledWith({ medicoId: 'm1' }));
    const tabelas = await screen.findAllByRole('table');
    expect(tabelas.length).toBeGreaterThan(1);
    const tabelaHistorico = tabelas[1] as HTMLElement;
    expect(within(tabelaHistorico).getByText('2026-05')).toBeInTheDocument();
  });

  it('médico sem cadastro busca histórico via cpf, não medicoId', async () => {
    renderComProviders();
    const linha = await screen.findByText('Dra. Sem Cadastro');
    fireEvent.click(linha.closest('tr') as HTMLElement);

    await waitFor(() =>
      expect(mockHistoricoMedico).toHaveBeenCalledWith({ cpf: '22222222222' }),
    );
  });

  it('mostra empty state quando não há médicos processados', async () => {
    mockResumoPorMedico.mockResolvedValue([]);
    renderComProviders();
    await waitFor(() =>
      expect(screen.getByText('Nenhum médico processado ainda')).toBeInTheDocument(),
    );
  });
});
