// Testes da factory de ContaBancariaPort e do MockContaGateway (Story 8.1, AC 5).
// Espelha o padrão da criarBoletoGateway (7.2): credenciais por conta via
// getCredenciaisConta; conta sem env → erro nomeando conta/vars; mock ignora a conta.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetServerEnv = vi.fn();
const mockGetCredenciaisConta = vi.fn();
vi.mock('@/lib/env', () => ({
  getServerEnv: () => mockGetServerEnv(),
  getCredenciaisConta: (...a: unknown[]) => mockGetCredenciaisConta(...a),
}));

// Captura o que o CoraContaGateway recebe no construtor (sem tocar em https/mTLS).
const mockCoraCtor = vi.fn();
vi.mock('@/server/gateway/cora-conta-gateway', () => ({
  CoraContaGateway: class {
    constructor(cred: unknown) {
      mockCoraCtor(cred);
    }
  },
}));

import { criarContaGateway } from '@/server/gateway/conta-gateway-factory';
import { MockContaGateway } from '@/server/gateway/mock-conta-gateway';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('criarContaGateway (mock)', () => {
  it('BOLETO_GATEWAY=mock → MockContaGateway, sem resolver credenciais', () => {
    mockGetServerEnv.mockReturnValue({ BOLETO_GATEWAY: 'mock' });
    const gateway = criarContaGateway('mc');
    expect(gateway).toBeInstanceOf(MockContaGateway);
    expect(mockGetCredenciaisConta).not.toHaveBeenCalled();
  });
});

describe('criarContaGateway (cora, multi-conta)', () => {
  it('injeta credenciais DISTINTAS por conta no CoraContaGateway', () => {
    mockGetServerEnv.mockReturnValue({ BOLETO_GATEWAY: 'cora' });
    const credMc = { clientId: 'client-mc' };
    const credCv = { clientId: 'client-cv' };
    mockGetCredenciaisConta.mockImplementation((conta: unknown) =>
      conta === 'mc' ? credMc : credCv,
    );

    criarContaGateway('mc');
    expect(mockGetCredenciaisConta).toHaveBeenCalledWith('mc');
    expect(mockCoraCtor).toHaveBeenCalledWith(credMc);

    criarContaGateway('cavalcante_viana');
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

    expect(() => criarContaGateway('cavalcante_viana')).toThrowError(/cavalcante_viana/);
    // MC continua operável na mesma execução (degradação por conta — arquitetura §5).
    expect(() => criarContaGateway('mc')).not.toThrow();
  });
});

describe('MockContaGateway', () => {
  it('extrato sintético é DETERMINÍSTICO: mesmo período → mesmas transações', async () => {
    const gw = new MockContaGateway();
    const a = await gw.consultarExtrato({ inicio: '2026-07-01', fim: '2026-07-10' });
    const b = await gw.consultarExtrato({ inicio: '2026-07-01', fim: '2026-07-10' });

    expect(a.sucesso).toBe(true);
    expect(b.sucesso).toBe(true);
    if (a.sucesso && b.sucesso) {
      expect(a.transacoes).toEqual(b.transacoes);
      expect(a.transacoes.length).toBeGreaterThan(0);
      // entryId estável por período — exercita o upsert idempotente em dev.
      expect(a.transacoes[0]?.entryId).toBe('MOCK-2026-07-01-credito-boleto');
    }
  });

  it('períodos diferentes → entryIds diferentes (não colide com sync anterior)', async () => {
    const gw = new MockContaGateway();
    const a = await gw.consultarExtrato({ inicio: '2026-07-01', fim: '2026-07-10' });
    const b = await gw.consultarExtrato({ inicio: '2026-08-01', fim: '2026-08-10' });
    if (a.sucesso && b.sucesso) {
      const idsA = a.transacoes.map((t) => t.entryId);
      const idsB = b.transacoes.map((t) => t.entryId);
      expect(idsA.every((id) => !idsB.includes(id))).toBe(true);
    }
  });

  it('cobre crédito conciliável, Pix, tarifa (FEE) e débito — insumos da 8.2/8.3', async () => {
    const gw = new MockContaGateway();
    const r = await gw.consultarExtrato({ inicio: '2026-07-01', fim: '2026-07-10' });
    expect(r.sucesso).toBe(true);
    if (r.sucesso) {
      const tipos = r.transacoes.map((t) => t.transactionType);
      expect(tipos).toContain('PAYMENT');
      expect(tipos).toContain('PIX');
      expect(tipos).toContain('FEE');
      expect(tipos).toContain('TRANSFER');
      // Crédito conciliável tem documento da contraparte (camada 1 do matching).
      const credito = r.transacoes.find((t) => t.transactionType === 'PAYMENT');
      expect(credito?.contraparteDocumento).toMatch(/^\d{11}$/);
    }
  });

  it('valida o período como o gateway real (contrato de erro igual em dev)', async () => {
    const gw = new MockContaGateway();
    const r = await gw.consultarExtrato({ inicio: 'ontem', fim: '2026-07-10' });
    expect(r.sucesso).toBe(false);
    if (!r.sucesso) expect(r.erro).toMatch(/YYYY-MM-DD/);
  });

  it('consultarSaldo devolve saldo fixo com timestamp', async () => {
    const r = await new MockContaGateway().consultarSaldo();
    expect(r.sucesso).toBe(true);
    if (r.sucesso) {
      expect(r.saldo.disponivel).toBe(25000.42);
      expect(r.saldo.consultadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
