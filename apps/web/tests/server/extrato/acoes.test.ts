// Testes das rotas de ação da conciliação (Story 8.2, AC 4) — conciliar/ignorar/desfazer.
// Chaves: validações de estado (409), mesma conta, boleto pago, trilha de quem/quando.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockBuscarTransacao = vi.fn();
const mockAtualizarStatus = vi.fn();
vi.mock('@/server/repositories/extrato-repository', () => ({
  buscarTransacao: (...a: unknown[]) => mockBuscarTransacao(...a),
  atualizarStatusConciliacao: (...a: unknown[]) => mockAtualizarStatus(...a),
}));

const mockBuscarBoleto = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  buscarBoleto: (...a: unknown[]) => mockBuscarBoleto(...a),
}));

import { POST as conciliarPOST } from '@/app/api/extrato/[id]/conciliar/route';
import { POST as ignorarPOST } from '@/app/api/extrato/[id]/ignorar/route';
import { POST as desfazerPOST } from '@/app/api/extrato/[id]/desfazer/route';

const BOLETO_UUID = '11111111-1111-4111-8111-111111111111';

function transacaoBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    contaEmissora: 'mc',
    entryId: 'e1',
    tipo: 'CREDIT',
    transactionType: 'PAYMENT',
    valor: 1500,
    descricao: null,
    contraparteNome: null,
    contraparteDocumento: '12345678901',
    dataTransacao: '2026-07-08T10:00:00Z',
    statusConciliacao: 'sugerido',
    boletoId: BOLETO_UUID,
    conciliadoPor: null,
    conciliadoEm: null,
    payload: {},
    sincronizadoEm: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

function boletoBase(overrides: Record<string, unknown> = {}) {
  return {
    id: BOLETO_UUID,
    execucaoResultadoId: 'r1',
    gateway: 'cora',
    contaEmissora: 'mc',
    idExterno: 'inv_1',
    status: 'pago',
    emitidoPor: 'u1',
    emitidoEm: '2026-07-01T00:00:00Z',
    payloadResposta: {},
    vencimento: '2026-08-01',
    pagoEm: '2026-07-08T09:00:00Z',
    valorPago: 1500,
    canceladoEm: null,
    canceladoPor: null,
    motivoCancelamento: null,
    ...overrides,
  };
}

function post(
  handler: typeof conciliarPOST,
  body: unknown = { boletoId: BOLETO_UUID },
  userId = 'user-fin',
) {
  mockRequireRole.mockResolvedValue({ userId, papel: 'financeiro' });
  const req = new Request('http://test/api/extrato/tx-1/acao', {
    method: 'POST',
    body: body == null ? undefined : JSON.stringify(body),
  });
  return handler(req, { params: { id: 'tx-1' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAtualizarStatus.mockResolvedValue(transacaoBase({ statusConciliacao: 'conciliado_manual' }));
});

describe('POST /api/extrato/[id]/conciliar', () => {
  it('confirma sugestão → conciliado_manual com trilha do usuário', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase());
    mockBuscarBoleto.mockResolvedValue(boletoBase());

    const res = await post(conciliarPOST);
    expect(res.status).toBe(200);
    expect(mockAtualizarStatus).toHaveBeenCalledWith('tx-1', {
      status: 'conciliado_manual',
      boletoId: BOLETO_UUID,
      usuarioId: 'user-fin',
    });
  });

  it('boletoId inválido → 400 sem tocar o banco', async () => {
    const res = await post(conciliarPOST, { boletoId: 'nao-uuid' });
    expect(res.status).toBe(400);
    expect(mockBuscarTransacao).not.toHaveBeenCalled();
  });

  it('transação inexistente → 404', async () => {
    mockBuscarTransacao.mockResolvedValue(null);
    const res = await post(conciliarPOST);
    expect(res.status).toBe(404);
  });

  it('transação DEBIT → 422 (só créditos conciliam)', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase({ tipo: 'DEBIT' }));
    const res = await post(conciliarPOST);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('TRANSACAO_NAO_E_CREDITO');
  });

  it('transação já conciliada → 409; ignorada → 409 pedindo desfazer', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase({ statusConciliacao: 'conciliado_auto' }));
    expect((await post(conciliarPOST)).status).toBe(409);

    mockBuscarTransacao.mockResolvedValue(transacaoBase({ statusConciliacao: 'ignorado' }));
    const res = await post(conciliarPOST);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('TRANSACAO_IGNORADA');
  });

  it('boleto não pago → 409 BOLETO_NAO_PAGO', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase());
    mockBuscarBoleto.mockResolvedValue(boletoBase({ status: 'emitido' }));
    const res = await post(conciliarPOST);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('BOLETO_NAO_PAGO');
  });

  it('contas diferentes → 409 CONTA_DIFERENTE (nunca cruza MC×CV)', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase({ contaEmissora: 'mc' }));
    mockBuscarBoleto.mockResolvedValue(boletoBase({ contaEmissora: 'cavalcante_viana' }));
    const res = await post(conciliarPOST);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONTA_DIFERENTE');
    expect(mockAtualizarStatus).not.toHaveBeenCalled();
  });

  it('corrida no UNIQUE parcial → 409 BOLETO_JA_CONCILIADO propagado do repository', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase());
    mockBuscarBoleto.mockResolvedValue(boletoBase());
    const { ApiError } = await import('@/lib/api-error');
    mockAtualizarStatus.mockRejectedValue(
      new ApiError(409, 'Boleto já está conciliado com outra transação do extrato.', 'BOLETO_JA_CONCILIADO'),
    );
    const res = await post(conciliarPOST);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('BOLETO_JA_CONCILIADO');
  });
});

describe('POST /api/extrato/[id]/ignorar', () => {
  it('marca ignorado com trilha (motivo opcional aceito)', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase({ statusConciliacao: 'sem_match' }));
    mockAtualizarStatus.mockResolvedValue(transacaoBase({ statusConciliacao: 'ignorado' }));

    const res = await post(ignorarPOST, { motivo: 'Transferência interna' });
    expect(res.status).toBe(200);
    expect(mockAtualizarStatus).toHaveBeenCalledWith('tx-1', {
      status: 'ignorado',
      usuarioId: 'user-fin',
    });
  });

  it('corpo vazio também funciona (motivo é opcional)', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase({ statusConciliacao: 'sem_match' }));
    mockAtualizarStatus.mockResolvedValue(transacaoBase({ statusConciliacao: 'ignorado' }));
    const res = await post(ignorarPOST, null);
    expect(res.status).toBe(200);
  });

  it('conciliada → 409 (desfazer antes); já ignorada → 409', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase({ statusConciliacao: 'conciliado_manual' }));
    expect((await post(ignorarPOST, {})).status).toBe(409);

    mockBuscarTransacao.mockResolvedValue(transacaoBase({ statusConciliacao: 'ignorado' }));
    expect((await post(ignorarPOST, {})).status).toBe(409);
  });
});

describe('POST /api/extrato/[id]/desfazer', () => {
  it('reverte para sem_match (libera o boleto)', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase({ statusConciliacao: 'conciliado_manual' }));
    mockAtualizarStatus.mockResolvedValue(transacaoBase({ statusConciliacao: 'sem_match', boletoId: null }));

    const res = await post(desfazerPOST, null);
    expect(res.status).toBe(200);
    expect(mockAtualizarStatus).toHaveBeenCalledWith('tx-1', { status: 'sem_match' });
  });

  it('sem vínculo → 409 NADA_A_DESFAZER', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase({ statusConciliacao: 'sem_match' }));
    const res = await post(desfazerPOST, null);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NADA_A_DESFAZER');
  });

  it('transação inexistente → 404', async () => {
    mockBuscarTransacao.mockResolvedValue(null);
    const res = await post(desfazerPOST, null);
    expect(res.status).toBe(404);
  });
});
