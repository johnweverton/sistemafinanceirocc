// Guarda de duplicidade do lote contábil (Story 12.3, risco RS-1 — Cenário A: bloqueio duro,
// sem opt-in nem exceção por cliente). Cobre: bloco "Já emitido nesta competência (N)" mostrado
// ANTES do clique em calcular, exclusão dos já cobertos do payload, reação à troca de competência
// e o cenário de regressão obrigatório "rodar o mesmo lote/competência duas vezes".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClienteContabilidade } from '@cobranca/shared';
import { ToastProvider } from '../../src/components/ui/Toast';

// Competência inicial fixa — senão o teste dependeria do mês em que roda.
vi.mock('../../src/lib/competencia', () => ({
  competenciaAtual: () => '2026-06',
  competenciaAnterior: () => '2026-05',
}));

const mockComBoleto = vi.fn();
const mockDispararLote = vi.fn();
const mockLancarFaturamentoLote = vi.fn();
vi.mock('../../src/services/clientes-contabilidade', () => ({
  clientesContabilidadeService: {
    comBoleto: (...a: unknown[]) => mockComBoleto(...a),
    dispararLote: (...a: unknown[]) => mockDispararLote(...a),
    lancarFaturamentoLote: (...a: unknown[]) => mockLancarFaturamentoLote(...a),
  },
  clienteContabilidadeQueryKeys: {
    clientes: () => ['clientes-contabilidade'],
    comBoleto: (c: string) => ['clientes-contabilidade', 'com-boleto', c],
  },
}));

const mockResultados = vi.fn();
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: { resultados: (...a: unknown[]) => mockResultados(...a) },
  execucaoQueryKeys: {
    execucoes: () => ['execucoes'],
    resultados: (id: string) => ['execucoes', id, 'resultados'],
  },
}));

import { LoteContabilidadeDialog } from '../../src/components/clientes-contabilidade/LoteContabilidadeDialog';

const clienteA: ClienteContabilidade = {
  id: 'cc-1',
  nome: 'Padaria Bom Pão Ltda',
  regimeTributario: 'simples_nacional' as const,
  modoCobranca: 'fixo' as const,
  regraPreco: null,
  cobranca: null,
  contaEmissora: 'mc' as const,
  condicoes: null,
  adicionalAtivo: false,
  adicionalValor: null,
  adicionalIntervaloMeses: null,
  adicionalCompetenciaBase: null,
  ativo: true,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};
const clienteB = { ...clienteA, id: 'cc-2', nome: 'Clínica Vida' };

function renderDialog(clientes: ClienteContabilidade[] = [clienteA, clienteB], onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LoteContabilidadeDialog clientes={clientes} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc, onClose };
}

function botaoCalcular() {
  return screen.queryByRole('button', { name: /Calcular \d+ em lote/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockComBoleto.mockResolvedValue({ clienteContabilidadeIds: [] });
  mockDispararLote.mockResolvedValue({ execucaoId: 'exec-1' });
  mockResultados.mockResolvedValue([]);
});

describe('LoteContabilidadeDialog — guarda de duplicidade (AC 3/4/5)', () => {
  it('consulta a rota nova com a competência selecionada', async () => {
    renderDialog();
    await waitFor(() => expect(mockComBoleto).toHaveBeenCalledWith('2026-06'));
  });

  it('mostra "Já emitido nesta competência (N)" antes do clique em calcular, com os nomes', async () => {
    mockComBoleto.mockResolvedValue({ clienteContabilidadeIds: ['cc-1'] });
    renderDialog();

    await waitFor(() => expect(screen.getByText(/Já emitido nesta competência \(1\)/)).toBeInTheDocument());
    // O nome aparece no bloco de excluídos e o botão já conta só o elegível — antes do clique.
    expect(screen.getByText('Padaria Bom Pão Ltda')).toBeInTheDocument();
    expect(botaoCalcular()).toHaveTextContent('Calcular 1 em lote');
    expect(mockDispararLote).not.toHaveBeenCalled();
  });

  it('não mostra o bloco quando ninguém tem boleto ativo na competência', async () => {
    renderDialog();
    await waitFor(() => expect(botaoCalcular()).toHaveTextContent('Calcular 2 em lote'));
    expect(screen.queryByText(/Já emitido nesta competência/)).not.toBeInTheDocument();
  });

  it('remove do payload quem já tem boleto ativo (bloqueio duro, sem opt-in)', async () => {
    mockComBoleto.mockResolvedValue({ clienteContabilidadeIds: ['cc-1'] });
    renderDialog();

    await waitFor(() => expect(botaoCalcular()).toBeEnabled());
    // Não existe nenhum controle para reincluir o cliente excluído (Cenário A).
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/emitir mesmo assim/i)).not.toBeInTheDocument();

    fireEvent.click(botaoCalcular()!);

    await waitFor(() => expect(mockDispararLote).toHaveBeenCalledTimes(1));
    expect(mockDispararLote).toHaveBeenCalledWith({
      competencia: '2026-06',
      clienteContabilidadeIds: ['cc-2'],
    });
  });

  it('trocar a competência refaz a consulta e atualiza a lista de já emitidos', async () => {
    mockComBoleto.mockImplementation((competencia: string) =>
      Promise.resolve({ clienteContabilidadeIds: competencia === '2026-06' ? ['cc-1'] : [] }),
    );
    renderDialog();

    await waitFor(() => expect(screen.getByText(/Já emitido nesta competência \(1\)/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });

    await waitFor(() => expect(mockComBoleto).toHaveBeenCalledWith('2026-07'));
    await waitFor(() => expect(screen.queryByText(/Já emitido nesta competência/)).not.toBeInTheDocument());
    expect(botaoCalcular()).toHaveTextContent('Calcular 2 em lote');

    fireEvent.click(botaoCalcular()!);
    await waitFor(() =>
      expect(mockDispararLote).toHaveBeenCalledWith({
        competencia: '2026-07',
        clienteContabilidadeIds: ['cc-1', 'cc-2'],
      }),
    );
  });

  it('todos os selecionados já emitidos → não há o que calcular, botão some', async () => {
    mockComBoleto.mockResolvedValue({ clienteContabilidadeIds: ['cc-1', 'cc-2'] });
    renderDialog();

    await waitFor(() => expect(screen.getByText(/Já emitido nesta competência \(2\)/)).toBeInTheDocument());
    expect(botaoCalcular()).not.toBeInTheDocument();
    expect(screen.getByText(/não há nada para calcular/i)).toBeInTheDocument();
  });

  it('enquanto a checagem não responde, calcular fica bloqueado (não dá pra excluir quem não se conhece)', async () => {
    mockComBoleto.mockReturnValue(new Promise(() => {}));
    renderDialog();

    const botao = await screen.findByRole('button', { name: /Verificando emissões/i });
    expect(botao).toBeDisabled();
    fireEvent.click(botao);
    expect(mockDispararLote).not.toHaveBeenCalled();
  });

  it('falha na checagem também bloqueia o cálculo (guarda não pode falhar aberta)', async () => {
    mockComBoleto.mockRejectedValue(new Error('timeout'));
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText(/Não foi possível checar quem já tem boleto/i)).toBeInTheDocument(),
    );
    expect(botaoCalcular()).not.toBeInTheDocument();
    expect(mockDispararLote).not.toHaveBeenCalled();
  });

  // Cenário de regressão obrigatório do épico: rodar o MESMO lote/competência duas vezes.
  it('rodar o mesmo lote/competência 2x não reenvia quem já recebeu boleto', async () => {
    // 1ª rodada: ninguém tem boleto ainda → os dois clientes entram.
    const primeira = renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());
    fireEvent.click(botaoCalcular()!);
    await waitFor(() => expect(mockDispararLote).toHaveBeenNthCalledWith(1, {
      competencia: '2026-06',
      clienteContabilidadeIds: ['cc-1', 'cc-2'],
    }));
    primeira.unmount();

    // Entre as rodadas, o boleto do cc-1 foi emitido — a rota (sem cache) já reflete isso.
    mockComBoleto.mockResolvedValue({ clienteContabilidadeIds: ['cc-1'] });

    // 2ª rodada, mesma seleção e mesma competência: cc-1 não pode ir de novo.
    renderDialog();
    await waitFor(() => expect(screen.getByText(/Já emitido nesta competência \(1\)/)).toBeInTheDocument());
    fireEvent.click(botaoCalcular()!);
    await waitFor(() => expect(mockDispararLote).toHaveBeenCalledTimes(2));
    expect(mockDispararLote).toHaveBeenNthCalledWith(2, {
      competencia: '2026-06',
      clienteContabilidadeIds: ['cc-2'],
    });
  });

  it('cliente excluído pela guarda também sai do lançamento de faturamento em massa', async () => {
    const faixaA = { ...clienteA, modoCobranca: 'faixa_faturamento' as const };
    const faixaB = { ...clienteB, modoCobranca: 'faixa_faturamento' as const };
    mockComBoleto.mockResolvedValue({ clienteContabilidadeIds: ['cc-1'] });
    renderDialog([faixaA, faixaB]);

    await waitFor(() => expect(screen.getByText(/Já emitido nesta competência \(1\)/)).toBeInTheDocument());
    // Só o cliente elegível pede faturamento (1 campo numérico), não os dois.
    expect(screen.getByText(/^1 cliente no modo/)).toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
  });
});
