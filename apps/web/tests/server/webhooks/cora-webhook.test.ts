// Testes da rota de webhook do Cora (Story 4.3) — sem rede/DB (mocks). Emissão desligada.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Story 7.2: env mutável por teste — permite exercitar os secrets por conta
// (CORA_MC_WEBHOOK_SECRET / CORA_CV_WEBHOOK_SECRET) além do legado.
let mockEnv: Record<string, string | undefined> = { CORA_WEBHOOK_SECRET: 'sekret' };
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

const mockConsultar = vi.fn();
// Story 7.2: captura a conta emissora usada na reconsulta (deve ser a do BOLETO).
const mockCriarGateway = vi.fn(() => ({
  gateway: { consultarInvoice: mockConsultar },
  nome: 'mock' as const,
}));
vi.mock('@/server/gateway/boleto-gateway-factory', () => ({
  criarBoletoGateway: (...args: unknown[]) => mockCriarGateway(...(args as [])),
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
    mockEnv = { CORA_WEBHOOK_SECRET: 'sekret' };
    mockBuscarPorIdExterno.mockResolvedValue({ id: 'b1', contaEmissora: 'mc' });
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

  // Fix QA 4.3 (MEDIUM): sem event_id nativo, a chave de idempotência é composta por tipo+invoice,
  // então dois eventos DIFERENTES da mesma invoice (paid depois canceled) NÃO colidem e ambos são
  // processados (o cancelamento após pagamento não é perdido).
  it('paid e canceled da mesma invoice (sem event_id) → ambos processados, eventoId distinto', async () => {
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');

    // 1º evento: pago
    mockConsultar.mockResolvedValueOnce({ status: 'paid', valorPago: 1500, pagoEm: '2026-06-15T00:00:00Z' });
    await POST(req({ resource: { id: 'inv_9' }, event: 'invoice.paid' }), { params: { secret: 'sekret' } });

    // 2º evento: cancelado (mesma invoice, sem event_id)
    mockConsultar.mockResolvedValueOnce({ status: 'canceled', valorPago: null, pagoEm: null });
    await POST(req({ resource: { id: 'inv_9' }, event: 'invoice.canceled' }), { params: { secret: 'sekret' } });

    // registrarEvento recebeu eventoIds DISTINTOS (por tipo), não colidiu no dedupe
    const ids = mockRegistrarEvento.mock.calls.map((c) => (c[0] as { eventoId: string }).eventoId);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toContain('invoice.paid:inv_9');
    expect(ids[1]).toContain('invoice.canceled:inv_9');

    // ambos deram baixa (não usa b.id como chave → 2º não é deduplicado)
    expect(mockRegistrarBaixa).toHaveBeenCalledTimes(2);
    expect(mockRegistrarBaixa).toHaveBeenNthCalledWith(1, 'inv_9', expect.objectContaining({ status: 'pago' }));
    expect(mockRegistrarBaixa).toHaveBeenNthCalledWith(2, 'inv_9', expect.objectContaining({ status: 'cancelado' }));
  });

  // -------------------------------------------------------------------------
  // Multi-conta (Story 7.2)
  // -------------------------------------------------------------------------

  it('secret da CV autentica; reconsulta usa a conta do BOLETO (não a do secret)', async () => {
    mockEnv = { CORA_MC_WEBHOOK_SECRET: 'segredo-mc-123', CORA_CV_WEBHOOK_SECRET: 'segredo-cv-456' };
    // Boleto foi emitido pela MC — mesmo o webhook chegando pelo endpoint da CV,
    // a reconsulta tem que ir na conta do boleto.
    mockBuscarPorIdExterno.mockResolvedValue({ id: 'b1', contaEmissora: 'mc' });
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');
    const resp = await POST(
      req({ resource: { id: 'inv_1' }, event: 'invoice.paid', event_id: 'evt_cv' }),
      { params: { secret: 'segredo-cv-456' } },
    );
    expect(resp.status).toBe(200);
    expect(mockCriarGateway).toHaveBeenCalledWith('mc');
    expect(mockRegistrarBaixa).toHaveBeenCalled();
  });

  it('secret legado continua autenticando a MC (fallback — regressão zero)', async () => {
    mockEnv = { CORA_WEBHOOK_SECRET: 'sekret' };
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');
    const resp = await POST(
      req({ resource: { id: 'inv_1' }, event: 'invoice.paid', event_id: 'evt_leg' }),
      { params: { secret: 'sekret' } },
    );
    expect(resp.status).toBe(200);
  });

  it('nenhum secret bate → 401 mesmo com os dois configurados', async () => {
    mockEnv = { CORA_MC_WEBHOOK_SECRET: 'segredo-mc-123', CORA_CV_WEBHOOK_SECRET: 'segredo-cv-456' };
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');
    const resp = await POST(req({ resource: { id: 'inv_1' } }), { params: { secret: 'errado' } });
    expect(resp.status).toBe(401);
    expect(mockRegistrarEvento).not.toHaveBeenCalled();
  });

  it('evento órfão (id externo sem boleto) → 200 sem reconsulta (não há conta para consultar)', async () => {
    mockBuscarPorIdExterno.mockResolvedValue(null);
    const { POST } = await import('@/app/api/webhooks/cora/[secret]/route');
    const resp = await POST(
      req({ resource: { id: 'inv_orfa' }, event: 'invoice.paid', event_id: 'evt_orfa' }),
      { params: { secret: 'sekret' } },
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ ok: true, semBoleto: true });
    // Evento fica na auditoria, mas nada de reconsulta/baixa.
    expect(mockRegistrarEvento).toHaveBeenCalled();
    expect(mockConsultar).not.toHaveBeenCalled();
    expect(mockRegistrarBaixa).not.toHaveBeenCalled();
  });
});
