// Testes da feature flag EXTRATO_SYNC_HABILITADO na rota POST /api/extrato/sincronizar (achado
// 2026-08-05): a Cora cobra por chamada de extrato, mas a baixa de boletos pagos já acontece de
// graça via webhook — desligado por padrão bloqueia a chamada paga sem afetar a baixa.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = {
  EXTRATO_SYNC_HABILITADO: 'false', // default: desligada
};
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockCriarContaGateway = vi.fn();
vi.mock('@/server/gateway/conta-gateway-factory', () => ({
  criarContaGateway: (...args: unknown[]) => mockCriarContaGateway(...args),
}));

const mockUltimoSync = vi.fn();
vi.mock('@/server/repositories/extrato-repository', () => ({
  upsertTransacoes: vi.fn(),
  registrarSync: vi.fn(),
  ultimoSync: (...args: unknown[]) => mockUltimoSync(...args),
  listarCreditosParaMatching: vi.fn(),
  aplicarTransicoesConciliacao: vi.fn(),
  listarTransacoes: vi.fn(),
  categorizarTransacao: vi.fn(),
}));

vi.mock('@/server/repositories/boleto-repository', () => ({
  listarBoletosPagosParaConciliacao: vi.fn(),
}));

vi.mock('@/server/repositories/plano-contas-repository', () => ({
  buscarCategoriasSistema: vi.fn(),
  listarRegras: vi.fn(),
}));

import { POST } from '@/app/api/extrato/sincronizar/route';

function reqPost(conta = 'mc') {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return POST(
    new Request('http://test/api/extrato/sincronizar', {
      method: 'POST',
      body: JSON.stringify({ conta }),
    }),
    { params: {} as Record<string, never> },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.EXTRATO_SYNC_HABILITADO = 'false';
});

describe('POST /api/extrato/sincronizar — feature flag EXTRATO_SYNC_HABILITADO', () => {
  it('desligada (default) → 403 EXTRATO_SYNC_DESABILITADO, nunca chama a Cora', async () => {
    const res = await reqPost();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('EXTRATO_SYNC_DESABILITADO');
    expect(mockCriarContaGateway).not.toHaveBeenCalled();
    expect(mockUltimoSync).not.toHaveBeenCalled();
  });

  it('ligada explicitamente → segue o fluxo normal (chega a montar o gateway)', async () => {
    mockEnv.EXTRATO_SYNC_HABILITADO = 'true';
    mockUltimoSync.mockResolvedValue(null);
    mockCriarContaGateway.mockImplementation(() => {
      throw new Error('parar aqui de propósito — só provar que passou do guard da flag');
    });

    const res = await reqPost();
    expect(res.status).not.toBe(403);
    expect(mockCriarContaGateway).toHaveBeenCalledWith('mc');
  });
});
