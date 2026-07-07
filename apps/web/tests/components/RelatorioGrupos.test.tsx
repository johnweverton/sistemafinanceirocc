// Teste da emissão de boleto a partir do relatório de execução (gap identificado 2026-07-07:
// a rota /api/boletos/emitir existia mas não havia nenhuma ação na UI para chamá-la).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ApiClientError } from '../../src/lib/api-client';

const mockResultados = vi.fn();
const mockRevisarResultado = vi.fn();
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: {
    resultados: (...a: unknown[]) => mockResultados(...a),
    revisarResultado: (...a: unknown[]) => mockRevisarResultado(...a),
  },
  execucaoQueryKeys: { resultados: (id: string) => ['execucoes', id, 'resultados'] },
}));

const mockEmitir = vi.fn();
vi.mock('../../src/services/boletos', () => ({
  boletosService: { emitir: (...a: unknown[]) => mockEmitir(...a) },
  CAMPO_COBRANCA_LABEL: { email: 'e-mail', cep: 'CEP' },
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

describe('RelatorioGrupos — emissão de boleto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResultados.mockResolvedValue([resultadoOk]);
  });

  it('emite o boleto ao clicar e mostra o badge de emitido', async () => {
    mockEmitir.mockResolvedValue({ boleto: { id: 'b1', status: 'emitido' } });
    renderComProviders();

    const btn = await screen.findByRole('button', { name: /Emitir boleto/i });
    fireEvent.click(btn);

    await waitFor(() => expect(mockEmitir).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.getByText('Boleto emitido')).toBeInTheDocument());
  });

  it('mostra os campos faltantes quando a cobrança do médico está incompleta', async () => {
    mockEmitir.mockRejectedValue(
      new ApiClientError(422, 'Dados de cobrança do médico incompletos', 'COBRANCA_INCOMPLETA', {
        faltantes: ['email', 'cep'],
      }),
    );
    renderComProviders();

    const btn = await screen.findByRole('button', { name: /Emitir boleto/i });
    fireEvent.click(btn);

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

    const btn = await screen.findByRole('button', { name: /Emitir boleto/i });
    fireEvent.click(btn);

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
