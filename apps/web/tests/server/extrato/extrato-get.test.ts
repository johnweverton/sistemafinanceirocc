// Testes da rota GET /api/extrato (Story 8.2, AC 3) — filtros Zod (whitelist) + totais.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockListarTransacoes = vi.fn();
vi.mock('@/server/repositories/extrato-repository', () => ({
  listarTransacoes: (...a: unknown[]) => mockListarTransacoes(...a),
}));

import { GET } from '@/app/api/extrato/route';

function transacao(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    contaEmissora: 'mc',
    entryId: 'e1',
    tipo: 'CREDIT',
    transactionType: 'PAYMENT',
    valor: 1500,
    descricao: null,
    contraparteNome: null,
    contraparteDocumento: null,
    dataTransacao: '2026-07-08T10:00:00Z',
    statusConciliacao: 'sem_match',
    boletoId: null,
    conciliadoPor: null,
    conciliadoEm: null,
    payload: {},
    sincronizadoEm: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

function reqGet(qs = '') {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/extrato${qs}`), { params: {} as Record<string, never> });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListarTransacoes.mockResolvedValue([]);
});

describe('GET /api/extrato', () => {
  it('repassa filtros validados ao repository (início/fim do dia em Brasília, OBS-822)', async () => {
    const res = await reqGet('?conta=mc&inicio=2026-07-01&fim=2026-07-10&status=sugerido&tipo=CREDIT');
    expect(res.status).toBe(200);
    expect(mockListarTransacoes).toHaveBeenCalledWith({
      contaEmissora: 'mc',
      dataInicio: '2026-07-01T00:00:00.000-03:00',
      dataFim: '2026-07-10T23:59:59.999-03:00',
      status: 'sugerido',
      tipo: 'CREDIT',
    });
  });

  it('status fora da whitelist → 400 VALIDATION', async () => {
    const res = await reqGet('?status=qualquer');
    expect(res.status).toBe(400);
    expect(mockListarTransacoes).not.toHaveBeenCalled();
  });

  it('data malformada → 400', async () => {
    const res = await reqGet('?inicio=01/07/2026');
    expect(res.status).toBe(400);
  });

  it('totais: créditos, débitos e tarifas (FEE é recorte dos débitos)', async () => {
    mockListarTransacoes.mockResolvedValue([
      transacao({ id: 't1', tipo: 'CREDIT', valor: 1500 }),
      transacao({ id: 't2', tipo: 'CREDIT', valor: 350.5 }),
      transacao({ id: 't3', tipo: 'DEBIT', transactionType: 'FEE', valor: 9.9 }),
      transacao({ id: 't4', tipo: 'DEBIT', transactionType: 'TRANSFER', valor: 2000 }),
    ]);

    const res = await reqGet();
    const body = await res.json();
    expect(body.transacoes).toHaveLength(4);
    expect(body.totais).toEqual({ creditos: 1850.5, debitos: 2009.9, tarifas: 9.9 });
  });
});
