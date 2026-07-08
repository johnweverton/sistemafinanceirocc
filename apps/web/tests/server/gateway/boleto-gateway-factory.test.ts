// Teste da factory de gateway (débito M-1 da Story 6.1): MOCK_INVOICE_STATUS controla a
// reconsulta do MockGateway — 'open' permite testar cancelamento em dev sem baixa falsa.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetServerEnv = vi.fn();
vi.mock('@/lib/env', () => ({
  getServerEnv: () => mockGetServerEnv(),
}));

import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('criarBoletoGateway (mock)', () => {
  it('default: reconsulta do mock devolve paid (fluxo do webhook em dev)', async () => {
    mockGetServerEnv.mockReturnValue({ BOLETO_GATEWAY: 'mock', MOCK_INVOICE_STATUS: 'paid' });
    const { gateway, nome } = criarBoletoGateway();
    expect(nome).toBe('mock');
    expect((await gateway.consultarInvoice('x')).status).toBe('paid');
  });

  it('MOCK_INVOICE_STATUS=open → reconsulta devolve open (cancelamento testável em dev)', async () => {
    mockGetServerEnv.mockReturnValue({ BOLETO_GATEWAY: 'mock', MOCK_INVOICE_STATUS: 'open' });
    const { gateway } = criarBoletoGateway();
    expect((await gateway.consultarInvoice('x')).status).toBe('open');
    // Com 'open', o fluxo de cancelamento segue até o gateway.cancelar (sempre sucesso no mock).
    expect((await gateway.cancelar('x')).sucesso).toBe(true);
  });
});
