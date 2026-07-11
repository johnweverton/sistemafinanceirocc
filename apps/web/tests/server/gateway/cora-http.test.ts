// Testes do CoraHttpClient (Story 8.1) — miolo mTLS comum extraído do CoraGateway.
// O comportamento fim-a-fim (emissão/cancelamento/reconsulta) segue coberto por
// cora-gateway.test.ts; aqui cobrimos o contrato próprio do client: cache de token
// por instância e invalidação.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CRED_TESTE = {
  certBase64: Buffer.from('FAKE-CERT-PEM').toString('base64'),
  keyBase64: Buffer.from('FAKE-KEY-PEM').toString('base64'),
  apiUrl: 'https://api.test.cora.com.br',
  clientId: 'test-client-id',
  webhookSecret: null,
};

const mockRequest = vi.fn();
const mockAgent = vi.fn();

vi.mock('node:https', () => ({
  default: {
    Agent: class MockAgent {
      constructor(opts: Record<string, unknown>) {
        mockAgent(opts);
      }
    },
    request: (...args: unknown[]) => mockRequest(...args),
  },
}));

/** Simula uma resposta HTTP do node:https.request (mesmo helper do cora-gateway.test.ts). */
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

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CoraHttpClient', () => {
  it('cacheia o token por instância: duas chamadas → uma request /token', async () => {
    mockRequest.mockImplementationOnce(
      simularResposta(200, { access_token: 'tok1', token_type: 'Bearer', expires_in: 3600 }),
    );

    const { CoraHttpClient } = await import('@/server/gateway/cora-http');
    const client = new CoraHttpClient(CRED_TESTE);

    expect(await client.obterToken()).toBe('tok1');
    expect(await client.obterToken()).toBe('tok1');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('invalidarToken força nova request de token', async () => {
    mockRequest
      .mockImplementationOnce(
        simularResposta(200, { access_token: 'tok1', token_type: 'Bearer', expires_in: 3600 }),
      )
      .mockImplementationOnce(
        simularResposta(200, { access_token: 'tok2', token_type: 'Bearer', expires_in: 3600 }),
      );

    const { CoraHttpClient } = await import('@/server/gateway/cora-http');
    const client = new CoraHttpClient(CRED_TESTE);

    expect(await client.obterToken()).toBe('tok1');
    client.invalidarToken();
    expect(await client.obterToken()).toBe('tok2');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('instâncias distintas NÃO compartilham token (isolamento por conta — Story 7.2)', async () => {
    mockRequest
      .mockImplementationOnce(
        simularResposta(200, { access_token: 'tok-mc', token_type: 'Bearer', expires_in: 3600 }),
      )
      .mockImplementationOnce(
        simularResposta(200, { access_token: 'tok-cv', token_type: 'Bearer', expires_in: 3600 }),
      );

    const { CoraHttpClient } = await import('@/server/gateway/cora-http');
    const mc = new CoraHttpClient(CRED_TESTE);
    const cv = new CoraHttpClient({ ...CRED_TESTE, clientId: 'outro-client' });

    expect(await mc.obterToken()).toBe('tok-mc');
    expect(await cv.obterToken()).toBe('tok-cv');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('token com erro HTTP lança com status e corpo (comportamento preservado do refactor)', async () => {
    mockRequest.mockImplementationOnce(simularResposta(401, { error: 'invalid_client' }));

    const { CoraHttpClient } = await import('@/server/gateway/cora-http');
    const client = new CoraHttpClient(CRED_TESTE);
    await expect(client.obterToken()).rejects.toThrowError(/Cora token error 401/);
  });

  it('normaliza baseUrl removendo barra final', async () => {
    const { CoraHttpClient } = await import('@/server/gateway/cora-http');
    const client = new CoraHttpClient({ ...CRED_TESTE, apiUrl: 'https://api.test.cora.com.br/' });
    expect(client.baseUrl).toBe('https://api.test.cora.com.br');
  });
});
