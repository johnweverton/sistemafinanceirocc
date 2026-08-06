// Teste da emissão de boleto a partir do relatório de execução (gap identificado 2026-07-07:
// a rota /api/boletos/emitir existia mas não havia nenhuma ação na UI para chamá-la).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ApiClientError } from '../../src/lib/api-client';

const mockResultados = vi.fn();
const mockRevisarResultado = vi.fn();
const mockContribuicoes = vi.fn();
const mockRecalcularResultado = vi.fn();
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: {
    resultados: (...a: unknown[]) => mockResultados(...a),
    revisarResultado: (...a: unknown[]) => mockRevisarResultado(...a),
    contribuicoes: (...a: unknown[]) => mockContribuicoes(...a),
    recalcularResultado: (...a: unknown[]) => mockRecalcularResultado(...a),
  },
  execucaoQueryKeys: {
    resultados: (id: string) => ['execucoes', id, 'resultados'],
    contribuicoes: (id: string) => ['execucoes', 'resultados', id, 'contribuicoes'],
  },
}));

const mockEmitir = vi.fn();
vi.mock('../../src/services/boletos', () => ({
  boletosService: { emitir: (...a: unknown[]) => mockEmitir(...a) },
  CAMPO_COBRANCA_LABEL: { email: 'e-mail', cep: 'CEP' },
}));

// Story 7.3: o diálogo de confirmação mostra a EMPRESA EMISSORA do médico.
const mockListarMedicos = vi.fn();
vi.mock('../../src/services/medicos', () => ({
  medicosService: { listar: (...a: unknown[]) => mockListarMedicos(...a) },
  queryKeys: { medicos: () => ['medicos'] },
}));

import { RelatorioGrupos } from '../../src/components/execucoes/RelatorioGrupos';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RelatorioGrupos execucaoId="exec-1" />
      </ToastProvider>
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

/** Abre o diálogo de confirmação (Story 7.3) e confirma a emissão. */
async function emitirViaDialogo() {
  const btn = await screen.findByRole('button', { name: /Emitir boleto/i });
  fireEvent.click(btn);
  // A empresa emissora do médico fica VISÍVEL antes da confirmação (AC 2).
  await screen.findByText('Cavalcante Viana');
  const confirmar = screen.getByRole('button', { name: /Confirmar emissão/i });
  await waitFor(() => expect(confirmar).toBeEnabled());
  fireEvent.click(confirmar);
}

describe('RelatorioGrupos — emissão de boleto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResultados.mockResolvedValue([resultadoOk]);
    mockListarMedicos.mockResolvedValue([{ id: 'm1', contaEmissora: 'cavalcante_viana' }]);
  });

  it('mostra a empresa emissora no diálogo e emite após confirmação (Story 7.3)', async () => {
    mockEmitir.mockResolvedValue({ boleto: { id: 'b1', status: 'emitido' } });
    renderComProviders();

    await emitirViaDialogo();

    await waitFor(() => expect(mockEmitir).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.getByText('Boleto emitido')).toBeInTheDocument());
  });

  it('cancelar no diálogo não emite nada', async () => {
    renderComProviders();
    fireEvent.click(await screen.findByRole('button', { name: /Emitir boleto/i }));
    await screen.findByText('Cavalcante Viana');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(mockEmitir).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Emitir boleto/i })).toBeInTheDocument();
  });

  it('mostra os campos faltantes quando a cobrança do médico está incompleta', async () => {
    mockEmitir.mockRejectedValue(
      new ApiClientError(422, 'Dados de cobrança do médico incompletos', 'COBRANCA_INCOMPLETA', {
        faltantes: ['email', 'cep'],
      }),
    );
    renderComProviders();

    await emitirViaDialogo();

    await waitFor(() =>
      expect(screen.getByText(/Dados de cobrança incompletos \(e-mail, CEP\)/)).toBeInTheDocument(),
    );
    // Não marca como emitido — o botão continua disponível para nova tentativa.
    expect(screen.getByRole('button', { name: /Emitir boleto/i })).toBeInTheDocument();
  });

  it('marca como emitido quando o boleto já existia (409 idempotente)', async () => {
    mockEmitir.mockRejectedValue(
      new ApiClientError(409, 'Já existe boleto emitido para este resultado.', 'BOLETO_JA_EMITIDO'),
    );
    renderComProviders();

    await emitirViaDialogo();

    await waitFor(() => expect(screen.getByText('Boleto emitido')).toBeInTheDocument());
  });
});

describe('RelatorioGrupos — busca por nome', () => {
  const resultadoAlerta = {
    ...resultadoOk,
    id: 'r2',
    nome: 'Dra. Outra Pessoa',
    status: 'alerta',
    alertas: ['1 procedimento sem valor.'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResultados.mockResolvedValue([resultadoOk, resultadoAlerta]);
    mockListarMedicos.mockResolvedValue([]);
  });

  it('filtra os grupos pelo nome digitado, sem afetar o total geral', async () => {
    renderComProviders();
    await screen.findByText('Dr. Teste');
    expect(screen.getByText('Dra. Outra Pessoa')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.901,78')).toBeInTheDocument(); // total geral = 2x 950,89

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar médico por nome' }), {
      target: { value: 'outra' },
    });

    await waitFor(() => expect(screen.queryByText('Dr. Teste')).not.toBeInTheDocument());
    expect(screen.getByText('Dra. Outra Pessoa')).toBeInTheDocument();
    expect(screen.getByText('Exibindo 1 de 2 médicos')).toBeInTheDocument();
    // Total geral continua somando os 2 resultados, não só o filtrado.
    expect(screen.getByText('R$ 1.901,78')).toBeInTheDocument();
  });
});

describe('RelatorioGrupos — revisão de alerta', () => {
  const resultadoAlerta = {
    ...resultadoOk,
    id: 'r2',
    nome: 'Dra. Alerta',
    status: 'alerta',
    alertas: ['VARIAÇÃO ALTA em relação ao mês anterior: 155 → 220 guias (42%).'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResultados.mockResolvedValue([resultadoAlerta]);
    mockListarMedicos.mockResolvedValue([]);
  });

  it('mantém o botão de confirmar desabilitado até o motivo ter pelo menos 5 caracteres', async () => {
    renderComProviders();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar e liberar' }));

    const confirmar = screen.getByRole('button', { name: 'Confirmar liberação' });
    expect(confirmar).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo da liberação' }), {
      target: { value: 'abc' },
    });
    expect(confirmar).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo da liberação' }), {
      target: { value: 'Confirmado com o médico.' },
    });
    expect(confirmar).toBeEnabled();
  });

  it('revisa e libera o resultado, que sai do grupo alerta após o refetch', async () => {
    mockRevisarResultado.mockResolvedValue({
      resultado: { ...resultadoAlerta, status: 'ok', statusOriginal: 'alerta' },
    });
    renderComProviders();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar e liberar' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo da liberação' }), {
      target: { value: 'Confirmado com o médico, aumento real de produção.' },
    });

    // Refetch (após invalidação) devolve o mesmo resultado já como 'ok'.
    mockResultados.mockResolvedValue([{ ...resultadoAlerta, status: 'ok', statusOriginal: 'alerta' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar liberação' }));

    await waitFor(() =>
      expect(mockRevisarResultado).toHaveBeenCalledWith(
        'exec-1',
        'r2',
        'Confirmado com o médico, aumento real de produção.',
      ),
    );
    await waitFor(() => expect(screen.queryByText('Revisar e liberar')).not.toBeInTheDocument());
    expect(screen.getByText('Revisado manualmente')).toBeInTheDocument();
  });

  it('cancelar fecha o formulário sem chamar o service', async () => {
    renderComProviders();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar e liberar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByRole('button', { name: 'Revisar e liberar' })).toBeInTheDocument();
    expect(mockRevisarResultado).not.toHaveBeenCalled();
  });
});

describe('RelatorioGrupos — recálculo de resultado (achado real 2026-08-04, Dr. José Neias)', () => {
  const resultadoAlertaComMedico = {
    ...resultadoOk,
    id: 'r-jose-neias',
    nome: 'JOSE NEIAS ARAUJO RIBEIRO',
    guias: 38,
    guiasConsolidado: 17,
    status: 'alerta',
    alertas: ['2 procedimento(s) sem código ou descrição na origem.'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResultados.mockResolvedValue([resultadoAlertaComMedico]);
    mockListarMedicos.mockResolvedValue([]);
  });

  it('mostra o botão Recalcular para resultado de médico sem boleto emitido', async () => {
    renderComProviders();
    await screen.findByText('JOSE NEIAS ARAUJO RIBEIRO');
    expect(screen.getByRole('button', { name: 'Recalcular' })).toBeInTheDocument();
  });

  it('ao clicar, chama o service e invalida o relatório após sucesso', async () => {
    mockRecalcularResultado.mockResolvedValue({
      resultado: { ...resultadoAlertaComMedico, guias: 19, guiasConsolidado: 19, status: 'ok', alertas: [] },
    });
    renderComProviders();
    await screen.findByText('JOSE NEIAS ARAUJO RIBEIRO');

    mockResultados.mockResolvedValue([
      { ...resultadoAlertaComMedico, guias: 19, guiasConsolidado: 19, status: 'ok', alertas: [] },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular' }));

    await waitFor(() => expect(mockRecalcularResultado).toHaveBeenCalledWith('r-jose-neias'));
    await waitFor(() => expect(screen.getByText(/19 guias/)).toBeInTheDocument());
  });

  it('não mostra o botão Recalcular para resultado agregado de empresa (sem medicoId)', async () => {
    mockResultados.mockResolvedValue([{ ...resultadoAlertaComMedico, medicoId: null, empresaId: 'empresa-1' }]);
    renderComProviders();
    await screen.findByText('JOSE NEIAS ARAUJO RIBEIRO');

    expect(screen.queryByRole('button', { name: 'Recalcular' })).not.toBeInTheDocument();
  });
});

describe('RelatorioGrupos — contribuições por médico de resultado agregado (Story 10.4c)', () => {
  const resultadoEmpresa = {
    ...resultadoOk,
    id: 'r-empresa-1',
    medicoId: null,
    empresaId: 'empresa-1',
    nome: 'MEDISA',
    cpf: '',
    totalValor: 2955.01,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResultados.mockResolvedValue([resultadoEmpresa]);
    mockListarMedicos.mockResolvedValue([
      { id: 'm1', nome: 'Dr. Alfa' },
      { id: 'm2', nome: 'Dr. Beta' },
    ]);
    mockContribuicoes.mockResolvedValue([
      { id: 'c1', execucaoResultadoId: 'r-empresa-1', medicoId: 'm1', guias: 150, valor: 961.5, criadoEm: '2026-06-01T00:00:00Z' },
      { id: 'c2', execucaoResultadoId: 'r-empresa-1', medicoId: 'm2', guias: 311, valor: 1993.51, criadoEm: '2026-06-01T00:00:00Z' },
    ]);
  });

  it('não busca contribuições até o operador abrir o detalhe (busca sob demanda)', async () => {
    renderComProviders();
    await screen.findByText('MEDISA');

    expect(screen.getByText('Ver contribuições por médico')).toBeInTheDocument();
    expect(mockContribuicoes).not.toHaveBeenCalled();
  });

  it('ao abrir, busca e exibe as contribuições com o nome do médico resolvido', async () => {
    renderComProviders();
    await screen.findByText('MEDISA');

    fireEvent.click(screen.getByText('Ver contribuições por médico'));

    await waitFor(() => expect(mockContribuicoes).toHaveBeenCalledWith('r-empresa-1'));
    await screen.findByText('Dr. Alfa');
    expect(screen.getByText('Dr. Beta')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('R$ 961,50')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.993,51')).toBeInTheDocument();
  });

  it('não mostra o detalhe de contribuições para resultado de médico individual (sem empresaId)', async () => {
    mockResultados.mockResolvedValue([resultadoOk]);
    renderComProviders();
    await screen.findByText('Dr. Teste');

    expect(screen.queryByText('Ver contribuições por médico')).not.toBeInTheDocument();
  });
});

describe('RelatorioGrupos — total de guias somando todos os lotes (achado real 2026-08-06, Dr. Felipe de Brito Rocha)', () => {
  // `r.guias` (52) só reflete o lote principal (HAPVIDA_CRED); o médico também tem Outros
  // Hospitais (11 guias) num lote separado (Story 10.5) — o resumo tinha que mostrar 63, a
  // soma dos dois, não só o lote principal.
  const resultadoFelipe = {
    ...resultadoOk,
    id: 'r-felipe',
    nome: 'FELIPE DE BRITO ROCHA',
    guias: 52,
    cirurgias: 139,
    guiasConsolidado: 52,
    subtotais: [
      { classe: 'HAPVIDA_CRED', guias: 52, valor: 697.71, faixa: 'até 80 guias' },
      { classe: 'OUTROS_HOSPITAIS', guias: 11, valor: 172.2, faixa: 'até 30 guias' },
    ],
    totalValor: 869.91,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResultados.mockResolvedValue([resultadoFelipe]);
    mockListarMedicos.mockResolvedValue([]);
  });

  it('mostra a soma de guias de todos os lotes (52 + 11 = 63), não só o lote principal (52)', async () => {
    renderComProviders();
    await screen.findByText('FELIPE DE BRITO ROCHA');

    expect(screen.getByText(/63 guias \(todos os lotes\)/)).toBeInTheDocument();
    expect(screen.getByText(/139 cirurgias · consolidado 52 \(lote principal\)/)).toBeInTheDocument();
  });

  it('resultado de lote único (sem Outros Hospitais/Imobilizações) não mostra o qualificador "(todos os lotes)"', async () => {
    mockResultados.mockResolvedValue([resultadoOk]);
    renderComProviders();
    await screen.findByText('Dr. Teste');

    expect(screen.getByText(/^1 guias/)).toBeInTheDocument();
    expect(screen.queryByText(/todos os lotes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/lote principal/)).not.toBeInTheDocument();
  });
});
