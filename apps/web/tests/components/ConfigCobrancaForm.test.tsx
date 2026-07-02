// Teste do formulário de configurações de cobrança (Story 3.3).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockLer = vi.fn();
const mockAtualizar = vi.fn();
vi.mock('../../src/services/config-cobranca', () => ({
  configCobrancaService: {
    ler: (...a: unknown[]) => mockLer(...a),
    atualizar: (...a: unknown[]) => mockAtualizar(...a),
  },
  configCobrancaQueryKeys: { config: () => ['config-cobranca'] },
}));

import { ConfigCobrancaForm } from '../../src/components/configuracoes/ConfigCobrancaForm';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConfigCobrancaForm />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ConfigCobrancaForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLer.mockResolvedValue({
      diasVencimento: 30,
      multaPercent: null,
      jurosMesPercent: null,
      descontoPercent: null,
      descontoDias: null,
    });
  });

  it('carrega e popula o campo de dias de vencimento', async () => {
    renderComProviders();
    await waitFor(() => {
      expect((screen.getByRole('spinbutton', { name: /Dias para vencimento/i }) as HTMLInputElement).value).toBe('30');
    });
    expect(screen.getByRole('button', { name: /Salvar configurações/i })).toBeInTheDocument();
  });
});
