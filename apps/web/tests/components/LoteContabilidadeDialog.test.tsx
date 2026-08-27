// Guarda de duplicidade do lote contábil (Story 12.3, risco RS-1 — Cenário A: bloqueio duro,
// sem opt-in nem exceção por cliente). Cobre: bloco "Já emitido nesta competência (N)" mostrado
// ANTES do clique em calcular, exclusão dos já cobertos do payload, reação à troca de competência
// e o cenário de regressão obrigatório "rodar o mesmo lote/competência duas vezes".
//
// Story 12.4 (loop do lançamento de faturamento em massa, RS-3): 100% de falha NÃO avança o passo
// 1, falhas listadas por nome em bloco persistente, "Tentar de novo (N)" só com os pendentes,
// troca de competência com valores digitados, e o débito DEB-12.3-B (staleTime da guarda +
// `!guardaPronta` no botão de lançar).
//
// Story 12.5 (composição do lote + progresso real, R-3/R-4): painel de composição com todos os
// grupos, teto/rate limit visíveis ANTES do clique, card "A emitir" somando só os `ok`,
// `execucaoId` sobrevivendo a um reload, reaproveitamento do `ProgressoExecucao` e Escape/backdrop
// no fluxo de composição (débito DEB-12.4-A).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClienteContabilidade } from '@cobranca/shared';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ApiClientError } from '../../src/lib/api-client';

// Competência inicial fixa — senão o teste dependeria do mês em que roda.
vi.mock('../../src/lib/competencia', () => ({
  competenciaAtual: () => '2026-06',
  competenciaAnterior: () => '2026-05',
}));

const mockComBoleto = vi.fn();
const mockDispararLote = vi.fn();
const mockLancarFaturamentoLote = vi.fn();
const mockFaturamentosLancados = vi.fn();
vi.mock('../../src/services/clientes-contabilidade', () => ({
  clientesContabilidadeService: {
    comBoleto: (...a: unknown[]) => mockComBoleto(...a),
    dispararLote: (...a: unknown[]) => mockDispararLote(...a),
    lancarFaturamentoLote: (...a: unknown[]) => mockLancarFaturamentoLote(...a),
    faturamentosLancados: (...a: unknown[]) => mockFaturamentosLancados(...a),
  },
  clienteContabilidadeQueryKeys: {
    clientes: () => ['clientes-contabilidade'],
    comBoleto: (c: string) => ['clientes-contabilidade', 'com-boleto', c],
    faturamentosLancados: (c: string) => ['clientes-contabilidade', 'faturamentos-lancados', c],
  },
}));

const mockResultados = vi.fn();
const mockDetalhe = vi.fn();
const mockRetomar = vi.fn();
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: {
    resultados: (...a: unknown[]) => mockResultados(...a),
    detalhe: (...a: unknown[]) => mockDetalhe(...a),
    retomar: (...a: unknown[]) => mockRetomar(...a),
  },
  execucaoQueryKeys: {
    execucoes: () => ['execucoes'],
    execucao: (id: string) => ['execucoes', id],
    resultados: (id: string) => ['execucoes', id, 'resultados'],
  },
}));

// Story 12.5: o diálogo agora renderiza o `ProgressoExecucao` de verdade (nada de reimplementar a
// barra), e ele assina Realtime. O hook NÃO é mockado de propósito — o teste tem que provar o
// reaproveitamento, então só o cliente Supabase vira dublê (mesmo padrão de Sidebar.test.tsx).
vi.mock('../../src/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => {},
  }),
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
  inativosSelecionados: ClienteContabilidade[] = [],
) {
  const utils = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LoteContabilidadeDialog
          clientes={clientes}
          inativosSelecionados={inativosSelecionados}
          onClose={onClose}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc, onClose };
}

function botaoCalcular() {
  return screen.queryByRole('button', { name: /Calcular \d+ em lote/i });
}

/** Execução de lote no estado que o teste precisar (a rota de lote só cria; quem processa é o retomar). */
function execucaoFake(over: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    competencia: '2026-06',
    iniciadoPor: 'u1',
    iniciadoEm: new Date().toISOString(),
    finalizadoEm: null,
    status: 'concluido',
    progresso: 100,
    totalMedicos: 0,
    totalOk: 0,
    totalAlerta: 0,
    totalSemDados: 0,
    totalAcumulado: 0,
    totalGeralValor: 0,
    empresaId: null,
    clienteContabilidadeId: null,
    ehAdicional: false,
    clientesContabilidadeIds: ['cc-1', 'cc-2'],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Story 12.5 (AC 5): o rastro do lote em andamento vive em sessionStorage — sem limpar, um teste
  // "recuperaria" a execução do anterior.
  sessionStorage.clear();
  mockComBoleto.mockResolvedValue({ clienteContabilidadeIds: [] });
  mockFaturamentosLancados.mockResolvedValue({ clienteContabilidadeIds: [] });
  mockDispararLote.mockResolvedValue({ execucaoId: 'exec-1' });
  mockRetomar.mockResolvedValue({ ok: true });
  mockDetalhe.mockResolvedValue(execucaoFake());
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
    // Story 12.5 (AC 5): o rastro do lote em andamento fica em sessionStorage. Entre as rodadas o
    // operador fechou o diálogo com o lote da 1ª rodada já concluído, o que limpa o rastro — sem
    // isso a 2ª montagem voltaria a ACOMPANHAR a execução anterior em vez de montar um lote novo.
    sessionStorage.clear();

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
    // Continua no passo 1: campos de faturamento na tela e nenhum botão de calcular.
    // (O sinal de "avançou" deixou de ser o texto "Pronto pra calcular N clientes" na 12.5 — ele
    // deu lugar ao painel de composição —, mas o botão de calcular só aparece no passo 2.)
    await waitFor(() => expect(screen.getAllByRole('spinbutton')).toHaveLength(2));
    expect(botaoCalcular()).not.toBeInTheDocument();
    expect(mockDispararLote).not.toHaveBeenCalled();
  });

  it('AC 1: com pelo menos um lançamento OK o passo avança (sem regressão no caminho feliz)', async () => {
    mockLancarFaturamentoLote.mockResolvedValue({ lancados: 2, falhas: [] });
    await preencher(['4500', '9000']);

    await waitFor(() => expect(botaoLancar()).toBeEnabled());
    fireEvent.click(botaoLancar()!);

    await waitFor(() => expect(botaoCalcular()).toHaveTextContent('Calcular 2 em lote'));
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
    expect(botaoCalcular()).toBeInTheDocument();
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

// ---------------------------------------------------------------------------------------------
// Story 12.5 — composição do lote (R-4) e progresso real do cálculo (R-3).
// ---------------------------------------------------------------------------------------------

const fixoC: ClienteContabilidade = { ...clienteA, id: 'cc-3', nome: 'Contábil Fixo Ltda' };
const semestral: ClienteContabilidade = {
  ...clienteA,
  id: 'cc-4',
  nome: 'Semestral SA',
  adicionalAtivo: true,
  adicionalValor: 900,
  adicionalIntervaloMeses: 6,
  // 2025-12 + 6 meses = 2026-06, a competência inicial dos testes → ciclo vencendo.
  adicionalCompetenciaBase: '2025-12',
};
const inativoX: ClienteContabilidade = { ...clienteA, id: 'cc-9', nome: 'Encerrado ME', ativo: false };
const inativoY: ClienteContabilidade = { ...clienteA, id: 'cc-10', nome: 'Baixado EPP', ativo: false };

/** Texto do painel de composição, com espaços normalizados (o resumo é montado em vários nós). */
function textoComposicao(): string {
  const titulo = screen.getByText(/Composição do lote/);
  return (titulo.closest('div')?.textContent ?? '').replace(/\s+/g, ' ');
}

const RESULTADO_OK = {
  id: 'r1',
  nome: 'Padaria Bom Pão Ltda',
  status: 'ok',
  totalValor: 1000,
  alertas: [],
};
const RESULTADO_ALERTA = {
  id: 'r2',
  nome: 'Clínica Vida',
  status: 'alerta',
  totalValor: 500,
  alertas: ['Faturamento não lançado'],
};

describe('LoteContabilidadeDialog — composição do lote antes do clique (Story 12.5, AC 1/2)', () => {
  it('AC 1: resumo estruturado com todos os grupos (faixa lançado/pendente, fixo, adicional, inativos)', async () => {
    mockFaturamentosLancados.mockResolvedValue({ clienteContabilidadeIds: ['cc-1'] });
    renderDialog([faixaA, faixaB, fixoC, semestral], vi.fn(), undefined, [inativoX, inativoY]);

    await waitFor(() => expect(textoComposicao()).toContain('2 em faixa de faturamento'));
    const texto = textoComposicao();
    // Y lançado · Z pendente vem do banco (rota nova), não do estado do diálogo.
    expect(texto).toContain('2 em faixa de faturamento (1 com faturamento lançado · 1 pendente)');
    expect(texto).toContain('2 em valor fixo');
    expect(texto).toContain(
      '1 com adicional semestral vencendo em 2026-06 — não incluído neste lote, gere individualmente (Semestral SA)',
    );
    expect(texto).toContain('2 inativos removidos da seleção');
    // E o texto ambíguo que a story substitui não voltou.
    expect(screen.queryByText(/Pronto pra calcular/i)).not.toBeInTheDocument();
    expect(mockFaturamentosLancados).toHaveBeenCalledWith('2026-06');
  });

  it('AC 1: enquanto a consulta de faturamento não responde o painel NÃO chuta "0 lançado"', async () => {
    mockFaturamentosLancados.mockReturnValue(new Promise(() => {}));
    renderDialog([faixaA, faixaB]);

    await waitFor(() => expect(textoComposicao()).toContain('2 em faixa de faturamento'));
    expect(textoComposicao()).toContain('verificando quais já têm faturamento lançado');
    expect(textoComposicao()).not.toContain('com faturamento lançado ·');
  });

  it('AC 1: falha na consulta de faturamento vira "não foi possível verificar", não um número inventado', async () => {
    mockFaturamentosLancados.mockRejectedValue(new Error('timeout'));
    renderDialog([faixaA, faixaB]);

    await waitFor(() =>
      expect(textoComposicao()).toContain('não foi possível verificar quais já têm faturamento lançado'),
    );
    // A falha é só do RESUMO: o fluxo continua (quem bloqueia é a guarda de duplicidade, que
    // respondeu normalmente aqui) — o passo 1 destes dois clientes de faixa segue disponível.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Digite ao menos um faturamento/i })).toBeInTheDocument();
  });

  it('AC 1: adicional que não vence na competência selecionada não gera aviso', async () => {
    renderDialog([fixoC, semestral]);

    await waitFor(() => expect(textoComposicao()).toContain('2 em valor fixo'));
    expect(textoComposicao()).toContain('adicional semestral vencendo em 2026-06');

    // 2025-12 + 6 = 2026-06; em 2026-07 o ciclo NÃO vence.
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });

    await waitFor(() => expect(textoComposicao()).not.toContain('adicional semestral vencendo'));
  });

  it('AC 1 (G-13): teto de 200 e rate limit de 3/min aparecem ANTES do clique', async () => {
    renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());

    expect(textoComposicao()).toContain(
      'Limites: até 200 clientes por lote · no máximo 3 cálculos por minuto.',
    );
  });

  it('AC 1 (G-13): acima do teto o cálculo é barrado aqui, não com um 422 depois do clique', async () => {
    const muitos = Array.from({ length: 201 }, (_, i) => ({
      ...clienteA,
      id: `cc-${i}`,
      nome: `Cliente ${i}`,
    }));
    renderDialog(muitos);

    const botao = await screen.findByRole('button', { name: /Acima do teto de 200/i });
    expect(botao).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/201 clientes para calcular, acima do teto de 200/);

    fireEvent.click(botao);
    expect(mockDispararLote).not.toHaveBeenCalled();
  });

  it('AC 1: lançar faturamento em massa revalida a contagem "lançado vs pendente"', async () => {
    mockLancarFaturamentoLote.mockResolvedValue({ lancados: 2, falhas: [] });
    await preencher(['4500', '9000']);

    await waitFor(() => expect(mockFaturamentosLancados).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /Lançar faturamentos e continuar/i }));

    // O resumo conta a partir do banco — escrever nele obriga a reconsultar.
    await waitFor(() => expect(mockFaturamentosLancados).toHaveBeenCalledTimes(2));
    expect(mockFaturamentosLancados).toHaveBeenLastCalledWith('2026-06');
  });

  it('AC 2: sem inativos na seleção o resumo não inventa a linha', async () => {
    renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());
    expect(textoComposicao()).not.toContain('removido');
  });
});

describe('LoteContabilidadeDialog — progresso real do cálculo (Story 12.5, AC 3/5)', () => {
  it('AC 3: a rota de lote cria a execução e o processamento vem em seguida (retomar)', async () => {
    renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());

    fireEvent.click(botaoCalcular()!);

    await waitFor(() => expect(mockDispararLote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockRetomar).toHaveBeenCalledWith('exec-1'));
  });

  it('AC 3: durante o cálculo aparece barra + % + role="status" do ProgressoExecucao reaproveitado', async () => {
    mockDetalhe.mockResolvedValue(execucaoFake({ status: 'processando', progresso: 42 }));
    mockRetomar.mockReturnValue(new Promise(() => {})); // cálculo ainda rodando
    renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());

    fireEvent.click(botaoCalcular()!);

    await waitFor(() => expect(screen.getByText('Calculando clientes contábeis')).toBeInTheDocument());
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('42%');
    // Prova de reaproveitamento (e não de reimplementação): a linha de espera e a detecção de
    // travamento continuam vindo de ProgressoExecucao.tsx.
    expect(screen.getByText(/Isso pode levar alguns minutos/i)).toBeInTheDocument();
    // Nada de resumo enquanto não concluiu — senão viraria "Ok 0 · A emitir R$ 0,00".
    expect(screen.queryByText(/A emitir/)).not.toBeInTheDocument();
    expect(mockResultados).not.toHaveBeenCalled();
  });

  it('AC 3: execução em erro é comunicada (mesmo bloco do ProgressoExecucao)', async () => {
    mockDetalhe.mockResolvedValue(execucaoFake({ status: 'erro' }));
    renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());

    fireEvent.click(botaoCalcular()!);

    await waitFor(() => expect(screen.getByText(/A execução encontrou um erro/i)).toBeInTheDocument());
  });

  it('AC 5: o execucaoId sobrevive a um "reload" no meio do cálculo (nada de execução órfã)', async () => {
    mockDetalhe.mockResolvedValue(execucaoFake({ status: 'processando', progresso: 10 }));
    mockRetomar.mockReturnValue(new Promise(() => {}));
    const primeira = renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());
    fireEvent.click(botaoCalcular()!);
    await waitFor(() => expect(mockRetomar).toHaveBeenCalledWith('exec-1'));

    // "Reload": desmonta e monta de novo, sem prop nenhuma carregando o id.
    primeira.unmount();
    renderDialog();

    await waitFor(() => expect(screen.getByText('Calculando clientes contábeis')).toBeInTheDocument());
    // Recuperou a MESMA execução em vez de disparar um lote novo.
    expect(mockDispararLote).toHaveBeenCalledTimes(1);
    expect(botaoCalcular()).not.toBeInTheDocument();
  });

  it('AC 5: lote concluído não é "recuperado" na próxima abertura (o rastro só dura enquanto há o que recuperar)', async () => {
    mockResultados.mockResolvedValue([RESULTADO_OK]);
    const primeira = renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());
    fireEvent.click(botaoCalcular()!);
    await waitFor(() => expect(screen.getByText(/A emitir/)).toBeInTheDocument());

    primeira.unmount();
    renderDialog();

    await waitFor(() => expect(botaoCalcular()).toBeEnabled());
    expect(screen.queryByText(/A emitir/)).not.toBeInTheDocument();
  });

  it('AC 5: rastro apontando para execução que não existe mais (404) devolve o diálogo ao começo', async () => {
    // Sem esta saída o diálogo ficaria preso: com `execucaoId` setado não há botão de calcular, e
    // fechar não apagaria o rastro (ele só some quando a execução conclui).
    sessionStorage.setItem(
      'cc-lote-contabilidade-execucao',
      JSON.stringify({ competencia: '2026-06', execucaoId: 'exec-fantasma' }),
    );
    mockDetalhe.mockRejectedValue(new ApiClientError(404, 'Execução não encontrada', 'NOT_FOUND'));
    renderDialog();

    await waitFor(() => expect(botaoCalcular()).toBeEnabled());
    expect(sessionStorage.getItem('cc-lote-contabilidade-execucao')).toBeNull();
  });

  it('AC 5: com o cálculo em voo mas o id já emitido, fechar por Escape é permitido (dá pra voltar)', async () => {
    mockDetalhe.mockResolvedValue(execucaoFake({ status: 'processando', progresso: 10 }));
    mockRetomar.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());
    fireEvent.click(botaoCalcular()!);
    await waitFor(() => expect(screen.getByText('Calculando clientes contábeis')).toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('LoteContabilidadeDialog — resumo pós-cálculo (Story 12.5, AC 4)', () => {
  it('AC 4: "A emitir" soma SÓ os `ok`; o total de todos vira linha secundária', async () => {
    mockResultados.mockResolvedValue([RESULTADO_OK, RESULTADO_ALERTA]);
    renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());

    fireEvent.click(botaoCalcular()!);

    await waitFor(() => expect(screen.getByText('A emitir (1 ok)')).toBeInTheDocument());
    expect(screen.getByText('R$ 1.000,00')).toBeInTheDocument(); // só o resultado ok
    expect(screen.getByText(/Total geral/)).toHaveTextContent('R$ 1.500,00');
    // O alerta continua listado por nome (não some do resumo, só do valor a emitir).
    expect(screen.getByText('Clínica Vida')).toBeInTheDocument();
  });

  it('AC 4: lote 100% em alerta mostra R$ 0,00 a emitir e nenhum botão de emissão', async () => {
    mockResultados.mockResolvedValue([RESULTADO_ALERTA]);
    renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());

    fireEvent.click(botaoCalcular()!);

    await waitFor(() => expect(screen.getByText('A emitir (0 ok)')).toBeInTheDocument());
    expect(screen.getByText('R$ 0,00')).toBeInTheDocument();
    expect(screen.getByText(/Total geral/)).toHaveTextContent('R$ 500,00');
    expect(screen.queryByRole('button', { name: /Emitir boletos em lote/i })).not.toBeInTheDocument();
  });
});

describe('LoteContabilidadeDialog — Escape/backdrop no fluxo de composição (Story 12.5, AC 6)', () => {
  it('Escape fecha o diálogo quando não há nada em voo', async () => {
    const { onClose } = renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clique no backdrop fecha o diálogo quando não há nada em voo', async () => {
    const { onClose } = renderDialog();
    await waitFor(() => expect(botaoCalcular()).toBeEnabled());

    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('com o lançamento de faturamento em voo, Escape NÃO fecha — avisa e mantém a tela', async () => {
    mockLancarFaturamentoLote.mockReturnValue(new Promise(() => {}));
    const { onClose } = await preencher(['4500', '9000']);
    fireEvent.click(await screen.findByRole('button', { name: /Lançar faturamentos e continuar/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Lançando/i })).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Aguarde o processamento terminar.')).toBeInTheDocument();
  });
});
