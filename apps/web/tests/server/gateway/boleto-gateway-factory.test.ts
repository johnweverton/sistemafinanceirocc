// Teste da factory de gateway.
// - Débito M-1 (Story 6.1): MOCK_INVOICE_STATUS controla a reconsulta do MockGateway.
// - Story 7.2: a factory recebe a CONTA EMISSORA e injeta as credenciais certas no
//   CoraGateway; conta sem credenciais → erro claro sem afetar a outra conta.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetServerEnv = vi.fn();
const mockGetCredenciaisConta = vi.fn();
vi.mock('@/lib/env', () => ({
  getServerEnv: () => mockGetServerEnv(),
  getCredenciaisConta: (...a: unknown[]) => mockGetCredenciaisConta(...a),
}));

// Captura o que o CoraGateway recebe no construtor (sem tocar em https/mTLS).
const mockCoraCtor = vi.fn();
vi.mock('@/server/gateway/cora-gateway', () => ({
  CoraGateway: class {
    constructor(cred: unknown) {
      mockCoraCtor(cred);
    }
  },
}));

import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('criarBoletoGateway (mock)', () => {
  it('default: reconsulta do mock devolve paid (fluxo do webhook em dev)', async () => {
    mockGetServerEnv.mockReturnValue({ BOLETO_GATEWAY: 'mock', MOCK_INVOICE_STATUS: 'paid' });
    const { gateway, nome } = criarBoletoGateway('mc');
    expect(nome).toBe('mock');
    expect((await gateway.consultarInvoice('x')).status).toBe('paid');
    // Mock ignora a conta: nenhuma credencial é resolvida.
    expect(mockGetCredenciaisConta).not.toHaveBeenCalled();
  });

  it('MOCK_INVOICE_STATUS=open → reconsulta devolve open (cancelamento testável em dev)', async () => {
    mockGetServerEnv.mockReturnValue({ BOLETO_GATEWAY: 'mock', MOCK_INVOICE_STATUS: 'open' });
    const { gateway } = criarBoletoGateway('cavalcante_viana');
    expect((await gateway.consultarInvoice('x')).status).toBe('open');
    expect((await gateway.cancelar('x')).sucesso).toBe(true);
  });
});

describe('criarBoletoGateway (cora, multi-conta — Story 7.2)', () => {
  it('injeta credenciais DISTINTAS por conta no CoraGateway', () => {
    mockGetServerEnv.mockReturnValue({ BOLETO_GATEWAY: 'cora' });
    const credMc = { clientId: 'client-mc' };
    const credCv = { clientId: 'client-cv' };
    mockGetCredenciaisConta.mockImplementation((conta: unknown) =>
      conta === 'mc' ? credMc : credCv,
    );

    criarBoletoGateway('mc');
    expect(mockGetCredenciaisConta).toHaveBeenCalledWith('mc');
    expect(mockCoraCtor).toHaveBeenCalledWith(credMc);

    criarBoletoGateway('cavalcante_viana');
    expect(mockGetCredenciaisConta).toHaveBeenCalledWith('cavalcante_viana');
    expect(mockCoraCtor).toHaveBeenCalledWith(credCv);
  });

  it('conta sem credenciais → erro claro propagado (a outra conta não é afetada)', () => {
    mockGetServerEnv.mockReturnValue({ BOLETO_GATEWAY: 'cora' });
    mockGetCredenciaisConta.mockImplementation((conta: unknown) => {
      if (conta === 'cavalcante_viana') {
        throw new Error("Credenciais da conta emissora 'cavalcante_viana' não configuradas.");
      }
      return { clientId: 'client-mc' };
    });

    expect(() => criarBoletoGateway('cavalcante_viana')).toThrowError(/cavalcante_viana/);
    // MC continua operável na mesma execução.
    expect(() => criarBoletoGateway('mc')).not.toThrow();
  });
});
