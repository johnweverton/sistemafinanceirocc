// Story 12.1 (AC 6 / risco RS-5) — o LoteEmissaoDialog tem DOIS consumidores reais e qualquer
// regressão na casca `<Modal>` propaga para os dois. Este arquivo abre o diálogo pelos dois
// caminhos de verdade (não por render direto do componente): o relatório de execuções e o lote
// contábil (que o abre substituindo a si mesmo — modal-dentro-de-modal, gap G-39).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockCriarPreview = vi.fn();
const mockConfirmar = vi.fn();
const mockStatus = vi.fn();
const mockRetomar = vi.fn();
const mockReprocessarItem = vi.fn();
vi.mock('../../src/services/boletos-lote', () => ({
  lotesEmissaoService: {
    criarPreview: (...a: unknown[]) => mockCriarPreview(...a),
    confirmar: (...a: unknown[]) => mockConfirmar(...a),
    status: (...a: unknown[]) => mockStatus(...a),
    retomar: (...a: unknown[]) => mockRetomar(...a),
    reprocessarItem: (...a: unknown[]) => mockReprocessarItem(...a),
  },
}));

const mockResultados = vi.fn();
// Story 12.5: o lote contábil passou a criar a execução e mandar processar em seguida
// (`retomar`), acompanhando por `detalhe` — daí estes dois entrarem no dublê do serviço.
const mockDetalheExecucao = vi.fn();
const mockRetomarExecucao = vi.fn();
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: {
    resultados: (...a: unknown[]) => mockResultados(...a),
    detalhe: (...a: unknown[]) => mockDetalheExecucao(...a),
    retomar: (...a: unknown[]) => mockRetomarExecucao(...a),
    revisarResultado: vi.fn(),
    contribuicoes: vi.fn(),
    recalcularResultado: vi.fn(),
  },
  execucaoQueryKeys: {
    execucoes: () => ['execucoes'],
    execucao: (id: string) => ['execucoes', id],
    resultados: (id: string) => ['execucoes', id, 'resultados'],
    contribuicoes: (id: string) => ['execucoes', 'resultados', id, 'contribuicoes'],
  },
}));

// O lote contábil renderiza `ProgressoExecucao` enquanto o cálculo não conclui, e ele assina
// Realtime. Só o cliente Supabase vira dublê (mesmo padrão de Sidebar.test.tsx).
vi.mock('../../src/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => {},
  }),
}));

vi.mock('../../src/services/boletos', () => ({
  boletosService: { emitir: vi.fn() },
  CAMPO_COBRANCA_LABEL: { email: 'e-mail', cep: 'CEP' },
}));

vi.mock('../../src/services/medicos', () => ({
  medicosService: { listar: vi.fn().mockResolvedValue([]) },
  queryKeys: { medicos: () => ['medicos'] },
}));

const mockDispararLote = vi.fn();
// `comBoleto` é a guarda de duplicidade da story 12.3: o LoteContabilidadeDialog consulta quem já
// tem boleto ativo na competência ANTES de deixar calcular. Aqui ela responde vazio — este arquivo
// testa a casca do modal e o fluxo de emissão, não a guarda (coberta em LoteContabilidadeDialog.test).
const mockComBoleto = vi.fn();
// `faturamentosLancados` (story 12.5) alimenta o painel de composição do lote — aqui responde
// vazio: este arquivo testa a casca do modal e o fluxo de emissão, não o resumo.
const mockFaturamentosLancados = vi.fn();
vi.mock('../../src/services/clientes-contabilidade', () => ({
  clientesContabilidadeService: {
    dispararLote: (...a: unknown[]) => mockDispararLote(...a),
    lancarFaturamentoLote: vi.fn(),
    comBoleto: (...a: unknown[]) => mockComBoleto(...a),
    faturamentosLancados: (...a: unknown[]) => mockFaturamentosLancados(...a),
  },
  clienteContabilidadeQueryKeys: {
    clientes: () => ['clientes-contabilidade'],
    comBoleto: (competencia: string) => ['clientes-contabilidade', 'com-boleto', competencia],
    faturamentosLancados: (competencia: string) => [
      'clientes-contabilidade',
      'faturamentos-lancados',
      competencia,
    ],
  },
}));

import { RelatorioGrupos } from '../../src/components/execucoes/RelatorioGrupos';
import { LoteContabilidadeDialog } from '../../src/components/clientes-contabilidade/LoteContabilidadeDialog';

function renderComProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const resultadoOk = {
  id: 'r1',
  execucaoId: 'exec-1',
  medicoId: 'm1',
  cpf: '11111111111',
  nome: 'Dr. Teste',
  procedimentos: 1,
  cirurgias: 0,
  guias: 1,
  guiasConsolidado: 1,
  subtotais: null,
  totalValor: 950.89,
  status: 'ok',
  alertas: [],
};

function previewCom(loteId: string, totalItens: number, totalValor: number) {
  return {
    lote: { id: loteId, snapshotTotalItens: totalItens, snapshotTotalValor: totalValor },
    itens: Array.from({ length: totalItens }, (_, i) => ({
      id: `i${i}`,
      nome: `Pagador ${i}`,
      status: 'pendente',
      codigoErro: null,
    })),
    porContaEmissora: [{ contaEmissora: 'mc', itens: totalItens, valor: totalValor }],
  };
}

/** Cliente contábil no modo `fixo` — não passa pela etapa de lançar faturamento. */
const clienteFixo = {
  id: 'cc-1',
  nome: 'Clínica X',
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
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Story 12.5 (AC 5): o rastro do lote em andamento vive em sessionStorage.
  sessionStorage.clear();
  mockComBoleto.mockResolvedValue({ clienteContabilidadeIds: [] });
  mockFaturamentosLancados.mockResolvedValue({ clienteContabilidadeIds: [] });
  mockRetomarExecucao.mockResolvedValue({ ok: true });
  // Story 12.5: o resumo do lote (e o botão "Emitir boletos em lote") só aparece com a execução
  // concluída — antes disso o que está na tela é a barra de progresso.
  mockDetalheExecucao.mockResolvedValue({
    id: 'exec-lote',
    competencia: '2026-08',
    iniciadoPor: 'u1',
    iniciadoEm: new Date().toISOString(),
    finalizadoEm: new Date().toISOString(),
    status: 'concluido',
    progresso: 100,
    totalMedicos: 0,
    totalOk: 1,
    totalAlerta: 0,
    totalSemDados: 0,
    totalAcumulado: 0,
    totalGeralValor: 950.89,
    empresaId: null,
    clienteContabilidadeId: null,
    ehAdicional: false,
    clientesContabilidadeIds: ['cc-1'],
  });
  mockCriarPreview.mockResolvedValue(previewCom('lote-1', 1, 950.89));
  mockConfirmar.mockResolvedValue({ lote: { id: 'lote-1', status: 'processando' } });
  mockStatus.mockResolvedValue({
    lote: {
      id: 'lote-1',
      status: 'processando',
      progresso: 50,
      totalEmitidos: 0,
      totalPulados: 0,
      totalFalhas: 0,
      totalValorEmitido: 0,
      motivoPausa: null,
    },
    itens: [],
  });
});

// ---------------------------------------------------------------------------
// Consumidor 1: relatório de execuções (RelatorioGrupos)
// ---------------------------------------------------------------------------
describe('LoteEmissaoDialog aberto pelo relatório de execuções (AC 6)', () => {
  beforeEach(() => mockResultados.mockResolvedValue([resultadoOk]));

  it('abre como diálogo acessível e monta o preview da execução do relatório', async () => {
    renderComProviders(<RelatorioGrupos execucaoId="exec-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Emitir todos os pendentes' }));

    await waitFor(() => expect(mockCriarPreview).toHaveBeenCalledWith('exec-1'));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    // Sem breadcrumb: aqui o diálogo não substituiu nenhum outro modal.
    expect(dialogo).toHaveAccessibleName('Emitir boletos em lote');
    expect(screen.queryByRole('button', { name: /Voltar ao lote/ })).not.toBeInTheDocument();
  });

  it('confirma o lote com o snapshot do preview (comportamento de negócio intacto)', async () => {
    renderComProviders(<RelatorioGrupos execucaoId="exec-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir todos os pendentes' }));

    const confirmar = await screen.findByRole('button', { name: /Confirmar emissão de 1/ });
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(mockConfirmar).toHaveBeenCalledWith('lote-1', { totalItens: 1, totalValor: 950.89 }),
    );
    // Lote confirmado roda no servidor: o diálogo continua fechável durante o acompanhamento
    // (o "Cancelar" vira "Fechar"). Escopo no diálogo — o toast também tem um "Fechar".
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar' }),
      ).toBeInTheDocument(),
    );
  });

  it('mostra o item com falha (nome + motivo) e permite reprocessar só aquele item', async () => {
    mockStatus.mockResolvedValue({
      lote: {
        id: 'lote-1',
        status: 'concluido',
        progresso: 100,
        totalEmitidos: 4,
        totalPulados: 0,
        totalFalhas: 1,
        totalValorEmitido: 3000,
        motivoPausa: null,
      },
      itens: [
        { id: 'item-falho', nome: 'Dr. Falhou', status: 'falha', codigoErro: 'FALHA_GATEWAY', mensagemErro: 'O gateway recusou a emissão. Ver auditoria do boleto para detalhes.' },
      ],
    });
    mockReprocessarItem.mockResolvedValue({ item: { id: 'item-falho', status: 'pendente' } });
    renderComProviders(<RelatorioGrupos execucaoId="exec-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir todos os pendentes' }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar emissão de 1/ }));

    expect(await screen.findByText('Dr. Falhou', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/O gateway recusou a emissão/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reprocessar' }));

    await waitFor(() => expect(mockReprocessarItem).toHaveBeenCalledWith('lote-1', 'item-falho'));
  });

  it('Escape fecha e devolve o foco ao gatilho do relatório', async () => {
    renderComProviders(<RelatorioGrupos execucaoId="exec-1" />);
    const gatilho = await screen.findByRole('button', { name: 'Emitir todos os pendentes' });
    gatilho.focus();
    fireEvent.click(gatilho);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(gatilho).toHaveFocus();
  });
});

// ---------------------------------------------------------------------------
// Consumidor 2: lote contábil (LoteContabilidadeDialog) — modal-dentro-de-modal
// ---------------------------------------------------------------------------
describe('LoteEmissaoDialog aberto pelo lote contábil (AC 5 + AC 6)', () => {
  /** Percorre o fluxo real até o botão "Emitir boletos em lote" do resumo do lote. */
  async function chegarAteAEmissao() {
    mockDispararLote.mockResolvedValue({ execucaoId: 'exec-lote' });
    mockResultados.mockResolvedValue([{ ...resultadoOk, id: 'rc1', nome: 'Clínica X', status: 'ok' }]);
    renderComProviders(<LoteContabilidadeDialog clientes={[clienteFixo]} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-08' } });
    // `findBy`, não `getBy`: a guarda de duplicidade (12.3) segura o botão em "Verificando
    // emissões…" até a checagem da competência responder — só então ele vira "Calcular N em lote".
    fireEvent.click(await screen.findByRole('button', { name: /Calcular 1 em lote/ }));

    await waitFor(() =>
      expect(mockDispararLote).toHaveBeenCalledWith({
        competencia: '2026-08',
        clienteContabilidadeIds: ['cc-1'],
      }),
    );
    return screen.findByRole('button', { name: 'Emitir boletos em lote' });
  }

  it('substitui o lote pelo diálogo de emissão com breadcrumb da competência', async () => {
    fireEvent.click(await chegarAteAEmissao());

    await waitFor(() => expect(mockCriarPreview).toHaveBeenCalledWith('exec-lote'));
    const dialogo = await screen.findByRole('dialog');
    // G-39: o operador enxerga que continua no MESMO lote, não num diálogo órfão.
    expect(dialogo).toHaveAccessibleName('Lote 2026-08 · Emitir boletos');
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    // Só um diálogo na tela: este SUBSTITUI o do lote, não empilha por cima.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('"← Voltar ao lote" devolve ao resumo do lote sem fechar o fluxo', async () => {
    const onClose = vi.fn();
    mockDispararLote.mockResolvedValue({ execucaoId: 'exec-lote' });
    mockResultados.mockResolvedValue([{ ...resultadoOk, id: 'rc1', nome: 'Clínica X', status: 'ok' }]);
    renderComProviders(<LoteContabilidadeDialog clientes={[clienteFixo]} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-08' } });
    // `findBy`, não `getBy`: a guarda de duplicidade (12.3) segura o botão em "Verificando
    // emissões…" até a checagem da competência responder — só então ele vira "Calcular N em lote".
    fireEvent.click(await screen.findByRole('button', { name: /Calcular 1 em lote/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir boletos em lote' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: /Voltar ao lote/ }));

    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/Calcular em lote/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('"Fechar" a partir da emissão encerra o fluxo inteiro', async () => {
    const onClose = vi.fn();
    mockDispararLote.mockResolvedValue({ execucaoId: 'exec-lote' });
    mockResultados.mockResolvedValue([{ ...resultadoOk, id: 'rc1', nome: 'Clínica X', status: 'ok' }]);
    renderComProviders(<LoteContabilidadeDialog clientes={[clienteFixo]} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-08' } });
    // `findBy`, não `getBy`: a guarda de duplicidade (12.3) segura o botão em "Verificando
    // emissões…" até a checagem da competência responder — só então ele vira "Calcular N em lote".
    fireEvent.click(await screen.findByRole('button', { name: /Calcular 1 em lote/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir boletos em lote' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('confirma o lote pelo caminho contábil com o mesmo snapshot (RS-5)', async () => {
    fireEvent.click(await chegarAteAEmissao());

    fireEvent.click(await screen.findByRole('button', { name: /Confirmar emissão de 1/ }));

    await waitFor(() =>
      expect(mockConfirmar).toHaveBeenCalledWith('lote-1', { totalItens: 1, totalValor: 950.89 }),
    );
  });
});
