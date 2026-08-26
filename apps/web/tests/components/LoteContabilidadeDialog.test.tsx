// Guarda de duplicidade do lote contábil (Story 12.3, risco RS-1 — Cenário A: bloqueio duro,
// sem opt-in nem exceção por cliente). Cobre: bloco "Já emitido nesta competência (N)" mostrado
// ANTES do clique em calcular, exclusão dos já cobertos do payload, reação à troca de competência
// e o cenário de regressão obrigatório "rodar o mesmo lote/competência duas vezes".
//
// Story 12.4 (loop do lançamento de faturamento em massa, RS-3): 100% de falha NÃO avança o passo
// 1, falhas listadas por nome em bloco persistente, "Tentar de novo (N)" só com os pendentes,
// troca de competência com valores digitados, e o débito DEB-12.3-B (staleTime da guarda +
// `!guardaPronta` no botão de lançar).
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

function renderDialog(
  clientes: ClienteContabilidade[] = [clienteA, clienteB],
  onClose = vi.fn(),
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
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
  mockLancarFaturamentoLote.mockResolvedValue({ lancados: 0, falhas: [] });
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

// ---------------------------------------------------------------------------------------------
// Story 12.4 — loop do lançamento de faturamento em massa (RS-3).
// ---------------------------------------------------------------------------------------------

const faixaA = { ...clienteA, modoCobranca: 'faixa_faturamento' as const };
const faixaB = { ...clienteB, modoCobranca: 'faixa_faturamento' as const };

const FALHA_A = {
  clienteContabilidadeId: 'cc-1',
  nome: 'Padaria Bom Pão Ltda',
  motivo: 'Falha ao lançar faturamento',
};
const FALHA_B = {
  clienteContabilidadeId: 'cc-2',
  nome: 'Clínica Vida',
  motivo: 'Falha ao lançar faturamento',
};

function botaoLancar() {
  return screen.queryByRole('button', { name: /Lançar faturamentos e continuar/i });
}

/** Renderiza o passo 1 já com os valores digitados nos campos de faturamento. */
async function preencher(valores: string[], clientes = [faixaA, faixaB]) {
  const utils = renderDialog(clientes);
  const campos = await screen.findAllByRole('spinbutton');
  valores.forEach((v, i) => {
    const campo = campos[i];
    if (v !== '' && campo) fireEvent.change(campo, { target: { value: v } });
  });
  return { ...utils, campos };
}

describe('LoteContabilidadeDialog — lançamento de faturamento em massa (Story 12.4)', () => {
  it('AC 1: 100% de falha NÃO avança — a tela continua no passo 1', async () => {
    mockLancarFaturamentoLote.mockResolvedValue({ lancados: 0, falhas: [FALHA_A, FALHA_B] });
    await preencher(['4500', '9000']);

    await waitFor(() => expect(botaoLancar()).toBeEnabled());
    fireEvent.click(botaoLancar()!);

    await waitFor(() => expect(mockLancarFaturamentoLote).toHaveBeenCalledTimes(1));
    // Continua no passo 1: campos de faturamento na tela, nada de "Pronto pra calcular".
    await waitFor(() => expect(screen.getAllByRole('spinbutton')).toHaveLength(2));
    expect(screen.queryByText(/Pronto pra calcular/i)).not.toBeInTheDocument();
    expect(botaoCalcular()).not.toBeInTheDocument();
    expect(mockDispararLote).not.toHaveBeenCalled();
  });

  it('AC 1: com pelo menos um lançamento OK o passo avança (sem regressão no caminho feliz)', async () => {
    mockLancarFaturamentoLote.mockResolvedValue({ lancados: 2, falhas: [] });
    await preencher(['4500', '9000']);

    await waitFor(() => expect(botaoLancar()).toBeEnabled());
    fireEvent.click(botaoLancar()!);

    await waitFor(() => expect(screen.getByText(/Pronto pra calcular/i)).toBeInTheDocument());
    expect(botaoCalcular()).toHaveTextContent('Calcular 2 em lote');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('AC 2: as falhas aparecem por NOME do cliente, com o motivo, em bloco persistente', async () => {
    mockLancarFaturamentoLote.mockResolvedValue({ lancados: 1, falhas: [FALHA_B] });
    await preencher(['4500', '9000']);

    fireEvent.click(await screen.findByRole('button', { name: /Lançar faturamentos e continuar/i }));

    await waitFor(() =>
      expect(screen.getByText('Clínica Vida: Falha ao lançar faturamento')).toBeInTheDocument(),
    );
    expect(screen.getByText(/1 faturamento\(s\) lançado\(s\), 1 falha\(s\)/)).toBeInTheDocument();
    // Persistente: sobrevive ao avanço para o passo de cálculo (não é toast).
    expect(screen.getByText(/Pronto pra calcular/i)).toBeInTheDocument();
    expect(screen.getByText('Clínica Vida: Falha ao lançar faturamento')).toBeInTheDocument();
    // E não sobrou UUID cru na tela.
    expect(screen.queryByText(/cc-2/)).not.toBeInTheDocument();
  });

  it('AC 3: "Tentar de novo (N que falharam)" remonta o passo 1 só com os pendentes', async () => {
    mockLancarFaturamentoLote.mockResolvedValue({ lancados: 1, falhas: [FALHA_B] });
    await preencher(['4500', '9000']);

    fireEvent.click(await screen.findByRole('button', { name: /Lançar faturamentos e continuar/i }));
    const retry = await screen.findByRole('button', { name: /Tentar de novo \(1 que falharam\)/i });

    fireEvent.click(retry);

    // Passo 1 de volta, mas só com quem falhou — o que já foi lançado não reaparece.
    await waitFor(() => expect(screen.getAllByRole('spinbutton')).toHaveLength(1));
    expect(screen.getByText('Clínica Vida')).toBeInTheDocument();
    expect(screen.queryByText('Padaria Bom Pão Ltda')).not.toBeInTheDocument();

    mockLancarFaturamentoLote.mockResolvedValue({ lancados: 1, falhas: [] });
    fireEvent.click(botaoLancar()!);

    await waitFor(() => expect(mockLancarFaturamentoLote).toHaveBeenCalledTimes(2));
    expect(mockLancarFaturamentoLote).toHaveBeenNthCalledWith(2, '2026-06', [
      { clienteContabilidadeId: 'cc-2', faturamento: 9000 },
    ]);
  });

  it('AC 4: trocar a competência com valores digitados limpa os campos e pede confirmação', async () => {
    const { campos } = await preencher(['4500', '']);
    expect(campos[0]).toHaveValue(4500);

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });

    // Estado seguro primeiro: os valores saem da tela e a confirmação pergunta se deve mantê-los.
    await waitFor(() => expect(screen.getByText('Manter os valores digitados?')).toBeInTheDocument());
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(null);
    expect(screen.getByText(/manter os 1 valores digitados para 2026-07/i)).toBeInTheDocument();
    expect(screen.getByText(/Padaria Bom Pão Ltda: R\$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Descartar e digitar de novo/i }));

    await waitFor(() => expect(screen.queryByText('Manter os valores digitados?')).not.toBeInTheDocument());
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(null);
  });

  it('AC 4: confirmar "manter" reaproveita os valores na competência nova', async () => {
    await preencher(['4500', '']);

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });
    fireEvent.click(
      await screen.findByRole('button', { name: /Manter os 1 valores em 2026-07/i }),
    );

    await waitFor(() => expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(4500));
    fireEvent.click(botaoLancar()!);
    await waitFor(() =>
      expect(mockLancarFaturamentoLote).toHaveBeenCalledWith('2026-07', [
        { clienteContabilidadeId: 'cc-1', faturamento: 4500 },
      ]),
    );
  });

  it('AC 4: sem valor digitado a troca de competência é direta, sem confirmação', async () => {
    renderDialog([faixaA, faixaB]);
    await screen.findAllByRole('spinbutton');

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });

    await waitFor(() => expect(mockComBoleto).toHaveBeenCalledWith('2026-07'));
    expect(screen.queryByText('Manter os valores digitados?')).not.toBeInTheDocument();
  });

  it('AC 5: lançar faturamento espera a guarda de duplicidade responder', async () => {
    mockComBoleto.mockReturnValue(new Promise(() => {}));
    await preencher(['4500', '9000']);

    const botao = await screen.findByRole('button', { name: /Verificando emissões/i });
    expect(botao).toBeDisabled();
    fireEvent.click(botao);
    expect(mockLancarFaturamentoLote).not.toHaveBeenCalled();
  });

  it('AC 5: guarda que falhou também bloqueia o lançamento (falha fechada, não aberta)', async () => {
    mockComBoleto.mockRejectedValue(new Error('timeout'));
    await preencher(['4500', '9000']);

    await waitFor(() =>
      expect(screen.getByText(/Não foi possível checar quem já tem boleto/i)).toBeInTheDocument(),
    );
    expect(botaoLancar()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verificando emissões/i })).toBeDisabled();
    expect(mockLancarFaturamentoLote).not.toHaveBeenCalled();
  });

  it('AC 5 (DEB-12.3-B): a guarda ignora o staleTime global — reabrir o diálogo revalida', async () => {
    // Mesmo QueryClient das duas montagens, com o staleTime padrão do app (app/providers.tsx).
    // Sem `staleTime: 0` na query, a 2ª montagem serviria a lista velha do cache por 30s.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const primeira = renderDialog([clienteA], vi.fn(), qc);
    await waitFor(() => expect(mockComBoleto).toHaveBeenCalledTimes(1));
    primeira.unmount();

    renderDialog([clienteA], vi.fn(), qc);
    await waitFor(() => expect(mockComBoleto).toHaveBeenCalledTimes(2));
  });

  it('sem nenhum valor digitado o botão de lançar fica desabilitado (evita 422 do schema)', async () => {
    renderDialog([faixaA, faixaB]);

    const botao = await screen.findByRole('button', { name: /Digite ao menos um faturamento/i });
    expect(botao).toBeDisabled();
    fireEvent.click(botao);
    expect(mockLancarFaturamentoLote).not.toHaveBeenCalled();
  });
});
