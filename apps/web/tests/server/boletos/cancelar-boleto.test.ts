// Testes da rota POST /api/boletos/[id]/cancelar (Story 6.1) — deps mockadas, sem rede/DB.
// Cobre: 404, estados não canceláveis (pago/cancelado/falha), corrida cancelamento×pagamento
// (reconsulta paid → baixa sincronizada + 409), sucesso completo e falha do gateway (502).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Boleto } from '@cobranca/shared';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockBuscarBoleto = vi.fn();
const mockCancelarBoleto = vi.fn();
const mockRegistrarBaixa = vi.fn();
const mockRegistrarEvento = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  buscarBoleto: (...args: unknown[]) => mockBuscarBoleto(...args),
  cancelarBoleto: (...args: unknown[]) => mockCancelarBoleto(...args),
  registrarBaixa: (...args: unknown[]) => mockRegistrarBaixa(...args),
  registrarEvento: (...args: unknown[]) => mockRegistrarEvento(...args),
}));

const mockConsultarInvoice = vi.fn();
const mockGatewayCancelar = vi.fn();
// Story 7.2: captura a conta emissora passada à factory (deve ser a do BOLETO).
const mockCriarGateway = vi.fn(() => ({
  gateway: {
    consultarInvoice: (...args: unknown[]) => mockConsultarInvoice(...args),
    cancelar: (...args: unknown[]) => mockGatewayCancelar(...args),
  },
  nome: 'mock',
}));
vi.mock('@/server/gateway/boleto-gateway-factory', () => ({
  criarBoletoGateway: (...args: unknown[]) => mockCriarGateway(...(args as [])),
}));

import { POST } from '@/app/api/boletos/[id]/cancelar/route';

function boletoBase(overrides: Partial<Boleto> = {}): Boleto {
  return {
    id: 'b1',
    execucaoResultadoId: 'r1',
    gateway: 'cora',
    contaEmissora: 'mc',
    idExterno: 'inv_1',
    status: 'emitido',
    emitidoPor: 'u1',
    emitidoEm: '2026-07-01T00:00:00Z',
    payloadResposta: {},
    vencimento: '2026-08-01',
    pagoEm: null,
    valorPago: null,
    canceladoEm: null,
    canceladoPor: null,
    motivoCancelamento: null,
    loteId: null,
    ...overrides,
  };
}

function reqCancelar(motivo = 'Valor incorreto — reemissão necessária', userId = 'user-admin') {
  mockRequireRole.mockResolvedValue({ userId, role: 'admin' });
  const req = new Request('http://test/api/boletos/b1/cancelar', {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
  return POST(req, { params: { id: 'b1' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRegistrarEvento.mockResolvedValue({ evento: {}, novo: true });
});

describe('POST /api/boletos/[id]/cancelar', () => {
  it('boleto inexistente → 404', async () => {
    mockBuscarBoleto.mockResolvedValue(null);
    const res = await reqCancelar();
    expect(res.status).toBe(404);
    expect(mockGatewayCancelar).not.toHaveBeenCalled();
  });

  it("status 'pago' local → 409 BOLETO_PAGO sem tocar o gateway", async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase({ status: 'pago' }));
    const res = await reqCancelar();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('BOLETO_PAGO');
    expect(mockConsultarInvoice).not.toHaveBeenCalled();
    expect(mockGatewayCancelar).not.toHaveBeenCalled();
  });

  it("status 'cancelado' → 409 idempotente (nada refeito)", async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase({ status: 'cancelado' }));
    const res = await reqCancelar();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('BOLETO_JA_CANCELADO');
    expect(mockGatewayCancelar).not.toHaveBeenCalled();
  });

  it("status 'falha' → 422 (nada a cancelar no gateway)", async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase({ status: 'falha', idExterno: null }));
    const res = await reqCancelar();
    expect(res.status).toBe(422);
    expect(mockGatewayCancelar).not.toHaveBeenCalled();
  });

  it('usa a conta emissora do BOLETO na factory — mesmo se o médico trocou de empresa (Story 7.2)', async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase({ contaEmissora: 'cavalcante_viana' }));
    mockConsultarInvoice.mockResolvedValue({ status: 'open', valorPago: null, pagoEm: null });
    mockGatewayCancelar.mockResolvedValue({ sucesso: true, payloadResposta: {} });
    mockCancelarBoleto.mockResolvedValue(boletoBase({ status: 'cancelado', contaEmissora: 'cavalcante_viana' }));
    const res = await reqCancelar();
    expect(res.status).toBe(200);
    expect(mockCriarGateway).toHaveBeenCalledWith('cavalcante_viana');
  });

  it('corrida: reconsulta devolve paid → sincroniza baixa e recusa com 409', async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase());
    mockConsultarInvoice.mockResolvedValue({
      status: 'paid',
      valorPago: 1500,
      pagoEm: '2026-07-08T09:00:00Z',
    });
    const res = await reqCancelar();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('BOLETO_PAGO');
    // Baixa sincronizada com os dados reais da Cora (mesmo efeito do webhook).
    expect(mockRegistrarBaixa).toHaveBeenCalledWith('inv_1', {
      status: 'pago',
      pagoEm: '2026-07-08T09:00:00Z',
      valorPago: 1500,
    });
    expect(mockGatewayCancelar).not.toHaveBeenCalled();
    expect(mockCancelarBoleto).not.toHaveBeenCalled();
  });

  it('já cancelado na Cora → sincroniza local e devolve 200 idempotente', async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase());
    mockConsultarInvoice.mockResolvedValue({ status: 'canceled', valorPago: null, pagoEm: null });
    mockCancelarBoleto.mockResolvedValue(boletoBase({ status: 'cancelado' }));
    const res = await reqCancelar();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jaCanceladoNaCora).toBe(true);
    expect(mockGatewayCancelar).not.toHaveBeenCalled(); // não repete o DELETE
    expect(mockCancelarBoleto).toHaveBeenCalledWith('b1', {
      canceladoPor: 'user-admin',
      motivo: 'Valor incorreto — reemissão necessária',
    });
  });

  it('sucesso: reconsulta open + gateway confirma → persiste cancelamento + evento + 200', async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase());
    mockConsultarInvoice.mockResolvedValue({ status: 'open', valorPago: null, pagoEm: null });
    mockGatewayCancelar.mockResolvedValue({ sucesso: true, payloadResposta: { ok: true } });
    mockCancelarBoleto.mockResolvedValue(
      boletoBase({ status: 'cancelado', canceladoPor: 'user-admin', motivoCancelamento: 'Valor incorreto — reemissão necessária' }),
    );

    const res = await reqCancelar();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.boleto.status).toBe('cancelado');

    expect(mockGatewayCancelar).toHaveBeenCalledWith('inv_1');
    expect(mockCancelarBoleto).toHaveBeenCalledWith('b1', {
      canceladoPor: 'user-admin',
      motivo: 'Valor incorreto — reemissão necessária',
    });
    // Trilha de auditoria: payload do gateway vai para boleto_eventos.
    expect(mockRegistrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({
        boletoId: 'b1',
        idExterno: 'inv_1',
        eventoTipo: 'cancelamento.manual',
        payload: { ok: true },
      }),
    );
  });

  it('gateway recusa (ex.: pagou no exato instante) → 502 + evento de falha, estado local intacto', async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase());
    mockConsultarInvoice.mockResolvedValue({ status: 'unknown', valorPago: null, pagoEm: null });
    mockGatewayCancelar.mockResolvedValue({
      sucesso: false,
      payloadResposta: { httpStatus: 400, body: { error: 'invoice_already_paid' } },
    });

    const res = await reqCancelar();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('CANCELAMENTO_FALHOU');
    expect(mockCancelarBoleto).not.toHaveBeenCalled(); // nunca marca cancelado sem confirmação
    expect(mockRegistrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({ eventoTipo: 'cancelamento.manual.falha' }),
    );
  });

  it('motivo ausente/curto → erro de validação, nada executado', async () => {
    mockBuscarBoleto.mockResolvedValue(boletoBase());
    const res = await reqCancelar('x');
    expect(res.ok).toBe(false);
    expect(mockGatewayCancelar).not.toHaveBeenCalled();
    expect(mockCancelarBoleto).not.toHaveBeenCalled();
  });
});
