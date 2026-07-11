// Testes do CoraContaGateway (Story 8.1) — mocks de node:https (sem rede, sem certificado).
// Chaves do AC 4: datas malformadas rejeitadas ANTES da chamada, paginação até esgotar
// (perPage=500), conversão centavos→reais e erro tipado (nunca exceção solta).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CRED_TESTE = {
  certBase64: Buffer.from('FAKE-CERT-PEM').toString('base64'),
  keyBase64: Buffer.from('FAKE-KEY-PEM').toString('base64'),
  apiUrl: 'https://api.test.cora.com.br',
  clientId: 'test-client-id',
  webhookSecret: null,
};

const mockRequest = vi.fn();

vi.mock('node:https', () => ({
  default: {
    Agent: class MockAgent {},
    request: (...args: unknown[]) => mockRequest(...args),
  },
}));

function simularResposta(statusCode: number, body: unknown) {
  return (
    _options: unknown,
    callback: (res: {
      statusCode: number;
      statusMessage: string;
      headers: Record<string, string>;
      on: (event: string, handler: (data?: unknown) => void) => void;
    }) => void,
  ) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const res = {
      statusCode,
      statusMessage: 'OK',
      headers: { 'content-type': 'application/json' },
      on: (event: string, handler: (data?: unknown) => void) => {
        if (event === 'data') handler(Buffer.from(bodyStr));
        if (event === 'end') handler();
      },
    };
    callback(res);
    return { on: vi.fn(), setTimeout: vi.fn(), write: vi.fn(), end: vi.fn(), destroy: vi.fn() };
  };
}

const TOKEN_OK = { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 };

/** Entrada válida do extrato no shape da API (pesquisa §1). */
function entryCora(i: number, extras: Record<string, unknown> = {}) {
  return {
    id: `entry-${i}`,
    type: 'CREDIT',
    amount: 150000, // centavos
    createdAt: '2026-07-08T10:00:00Z',
    transaction: {
      type: 'PAYMENT',
      description: `Liquidação ${i}`,
      counterParty: { name: 'Dr. Teste', identity: '123.456.789-01' },
    },
    ...extras,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CoraContaGateway.consultarExtrato', () => {
  it('rejeita datas fora de YYYY-MM-DD ANTES de qualquer chamada (formato errado → 500 na Cora)', async () => {
    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const gw = new CoraContaGateway(CRED_TESTE);

    const r = await gw.consultarExtrato({ inicio: '08/07/2026', fim: '2026-07-10' });
    expect(r.sucesso).toBe(false);
    if (!r.sucesso) expect(r.erro).toMatch(/YYYY-MM-DD/);
    // Nenhuma request de rede (nem token) foi disparada.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('consulta com params corretos e mapeia centavos→reais e documento só dígitos', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, TOKEN_OK))
      .mockImplementationOnce(simularResposta(200, { entries: [entryCora(1)] }));

    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const r = await new CoraContaGateway(CRED_TESTE).consultarExtrato({
      inicio: '2026-07-01',
      fim: '2026-07-10',
    });

    expect(r.sucesso).toBe(true);
    if (r.sucesso) {
      expect(r.transacoes).toHaveLength(1);
      expect(r.transacoes[0]).toMatchObject({
        entryId: 'entry-1',
        tipo: 'CREDIT',
        transactionType: 'PAYMENT',
        valor: 1500, // 150000 centavos
        contraparteNome: 'Dr. Teste',
        contraparteDocumento: '12345678901', // só dígitos
        dataTransacao: '2026-07-08T10:00:00Z',
      });
    }

    // Request do extrato (2ª chamada) com start/end/page/perPage no formato do contrato.
    const opts = mockRequest.mock.calls[1]?.[0] as { path: string };
    expect(opts.path).toContain('/bank-statement/statement');
    expect(opts.path).toContain('start=2026-07-01');
    expect(opts.path).toContain('end=2026-07-10');
    expect(opts.path).toContain('page=1');
    expect(opts.path).toContain('perPage=500');
  });

  it('pagina até esgotar: página cheia (500) busca a próxima; incompleta encerra', async () => {
    const pagina1 = Array.from({ length: 500 }, (_, i) => entryCora(i));
    const pagina2 = [entryCora(500), entryCora(501)];
    mockRequest
      .mockImplementationOnce(simularResposta(200, TOKEN_OK))
      .mockImplementationOnce(simularResposta(200, { entries: pagina1 }))
      .mockImplementationOnce(simularResposta(200, { entries: pagina2 }));

    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const r = await new CoraContaGateway(CRED_TESTE).consultarExtrato({
      inicio: '2026-07-01',
      fim: '2026-07-10',
    });

    expect(r.sucesso).toBe(true);
    if (r.sucesso) expect(r.transacoes).toHaveLength(502);
    // token + 2 páginas
    expect(mockRequest).toHaveBeenCalledTimes(3);
    const paths = mockRequest.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(paths[1]).toContain('page=1');
    expect(paths[2]).toContain('page=2');
  });

  it('entrada sem campos mínimos é descartada; as demais seguem', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, TOKEN_OK))
      .mockImplementationOnce(
        simularResposta(200, {
          entries: [entryCora(1), { id: 'quebrada' }, entryCora(2, { type: 'DEBIT' })],
        }),
      );

    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const r = await new CoraContaGateway(CRED_TESTE).consultarExtrato({
      inicio: '2026-07-01',
      fim: '2026-07-10',
    });
    expect(r.sucesso).toBe(true);
    if (r.sucesso) {
      expect(r.transacoes).toHaveLength(2);
      expect(r.transacoes[1]?.tipo).toBe('DEBIT');
    }
  });

  it('HTTP 500 da Cora → sucesso=false com erro tipado (nunca lança)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, TOKEN_OK))
      .mockImplementationOnce(simularResposta(500, { error: 'internal' }));

    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const r = await new CoraContaGateway(CRED_TESTE).consultarExtrato({
      inicio: '2026-07-01',
      fim: '2026-07-10',
    });
    expect(r.sucesso).toBe(false);
    if (!r.sucesso) expect(r.erro).toMatch(/HTTP 500/);
  });

  it('erro de rede → sucesso=false (nunca lança)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, TOKEN_OK))
      .mockImplementationOnce((_options: unknown, _cb: unknown) => ({
        on: (event: string, handler: (err: Error) => void) => {
          if (event === 'error') handler(new Error('ECONNRESET'));
        },
        setTimeout: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      }));

    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const r = await new CoraContaGateway(CRED_TESTE).consultarExtrato({
      inicio: '2026-07-01',
      fim: '2026-07-10',
    });
    expect(r.sucesso).toBe(false);
    if (!r.sucesso) expect(r.erro).toContain('ECONNRESET');
  });
});

describe('CoraContaGateway.consultarSaldo', () => {
  it('mapeia saldo em centavos → reais (campos assumidos: available/blocked)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, TOKEN_OK))
      .mockImplementationOnce(simularResposta(200, { available: 2500042, blocked: 10000 }));

    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const r = await new CoraContaGateway(CRED_TESTE).consultarSaldo();

    expect(r.sucesso).toBe(true);
    if (r.sucesso) {
      expect(r.saldo.disponivel).toBe(25000.42);
      expect(r.saldo.bloqueado).toBe(100);
      expect(r.saldo.consultadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    const opts = mockRequest.mock.calls[1]?.[0] as { path: string };
    expect(opts.path).toBe('/third-party/account/balance');
  });

  it('resposta sem campo de valor reconhecível → sucesso=false', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, TOKEN_OK))
      .mockImplementationOnce(simularResposta(200, { foo: 'bar' }));

    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const r = await new CoraContaGateway(CRED_TESTE).consultarSaldo();
    expect(r.sucesso).toBe(false);
  });

  it('HTTP 503 → sucesso=false com erro tipado', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, TOKEN_OK))
      .mockImplementationOnce(simularResposta(503, { error: 'unavailable' }));

    const { CoraContaGateway } = await import('@/server/gateway/cora-conta-gateway');
    const r = await new CoraContaGateway(CRED_TESTE).consultarSaldo();
    expect(r.sucesso).toBe(false);
    if (!r.sucesso) expect(r.erro).toMatch(/HTTP 503/);
  });
});
