// Testes da rota de webhook do Cora (Story 4.3) — sem rede/DB (mocks). Emissão desligada.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = { CORA_WEBHOOK_SECRET: 'sekret' };
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

const mockConsultar = vi.fn();
vi.mock('@/server/gateway/boleto-gateway-factory', () => ({
  criarBoletoGateway: () => ({ gateway: { consultarInvoice: mockConsultar }, nome: 'mock' as const }),
}));

const mockRegistrarEvento = vi.fn();
const mockRegistrarBaixa = vi.fn();
const mockBuscarPorIdExterno = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  registrarEvento: (...a: unknown[]) => mockRegistrarEvento(...a),
  registrarBaixa: (...a: unknown[]) => mockRegistrarBaixa(...a),
  buscarBoletoPorIdExterno: (...a: unknown[]) => mockBuscarPorIdExterno(...a),
}));

function req(body: unknown): Request {
  return new Request('http://localhost/api/webhooks/cora/sekret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Webhook Cora', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuscarPorIdExterno.mockResolvedValue({ id: 'b1' });
    mockRegistrarEvento.mockResolvedValue({ evento: { id: 'ev1' }, novo: true });
    mockConsultar.mockResolvedValue({ status: 'paid', valorPago: 1500, pagoEm: '2026-06-15T00:00:00Z' });
    mockRegistrarBaixa.mockResolvedValue({ atualizado: true, boleto: {} });
  });

  it('secret inválido → 401', async () => {
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');
    const resp = await POST(req({ resource: { id: 'inv_1' } }), { params: { secret: 'errado' } });
    expect(resp.status).toBe(401);
    expect(mockRegistrarEvento).not.toHaveBeenCalled();
  });

  it('evento pago → reconsulta e dá baixa "pago"', async () => {
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');
    const resp = await POST(
      req({ resource: { id: 'inv_1' }, event: 'invoice.paid', event_id: 'evt_1' }),
      { params: { secret: 'sekret' } },
    );
    expect(resp.status).toBe(200);
    expect(mockConsultar).toHaveBeenCalledWith('inv_1');
    expect(mockRegistrarBaixa).toHaveBeenCalledWith(
      'inv_1',
      expect.objectContaining({ status: 'pago', valorPago: 1500 }),
    );
  });

  it('reentrega (evento já visto) → não reprocessa (dedupe)', async () => {
    mockRegistrarEvento.mockResolvedValue({ evento: { id: 'ev1' }, novo: false });
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');
    const resp = await POST(
      req({ resource: { id: 'inv_1' }, event_id: 'evt_1' }),
      { params: { secret: 'sekret' } },
    );
    expect(resp.status).toBe(200);
    expect(mockConsultar).not.toHaveBeenCalled();
    expect(mockRegistrarBaixa).not.toHaveBeenCalled();
  });

  it('evento sem id externo → 200 sem baixa', async () => {
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');
    const resp = await POST(req({ event: 'ping' }), { params: { secret: 'sekret' } });
    expect(resp.status).toBe(200);
    expect(mockConsultar).not.toHaveBeenCalled();
    expect(mockRegistrarBaixa).not.toHaveBeenCalled();
  });
});
