// Teste da emissão de boleto a partir do relatório de execução (gap identificado 2026-07-07:
// a rota /api/boletos/emitir existia mas não havia nenhuma ação na UI para chamá-la).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';
import { ApiClientError } from '../../src/lib/api-client';

const mockResultados = vi.fn();
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: { resultados: (...a: unknown[]) => mockResultados(...a) },
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
