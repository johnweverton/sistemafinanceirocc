// Testes do CoraGateway — mocks de https (sem certificado real, sem rede).
// Verifica que o gateway:
//   - Cria https.Agent com cert/key corretos.
//   - Obtém token OAuth2 antes de emitir.
//   - Trata erros da API sem lançar (retorna status 'falha').
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DadosEmissaoBoleto } from '@cobranca/shared';

// Mock do env antes de importar o módulo.
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CORA_CERT_BASE64: Buffer.from('FAKE-CERT-PEM').toString('base64'),
    CORA_KEY_BASE64: Buffer.from('FAKE-KEY-PEM').toString('base64'),
    CORA_API_URL: 'https://api.test.cora.com.br',
    CORA_CLIENT_ID: 'test-client-id',
    GATEWAY_EMISSAO_HABILITADA: 'true',
    BOLETO_GATEWAY: 'cora',
  })),
}));

// Mock do node:https para interceptar requests mTLS sem rede.
const mockRequest = vi.fn();
const mockAgent = vi.fn();

vi.mock('node:https', () => ({
  default: {
    Agent: class MockAgent {
      constructor(opts: Record<string, unknown>) {
        mockAgent(opts);
      }
    },
    request: (...args: unknown[]) => {
      return mockRequest(...args);
    },
  },
}));

const dadosPadrao: DadosEmissaoBoleto = {
  execucaoResultadoId: '00000000-0000-0000-0000-000000000001',
  cpfMedico: '12345678901',
  nomeMedico: 'Dr. Teste',
  competencia: '2025-06',
  valor: 1500.0,
};

/** Simula uma resposta HTTP do node:https.request. */
function simularResposta(statusCode: number, body: unknown) {
  return (
    _options: unknown,
    callback: (res: { statusCode: number; statusMessage: string; headers: Record<string, string>; on: (event: string, handler: (data?: unknown) => void) => void }) => void,
  ) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const res = {
      statusCode,
      statusMessage: statusCode === 200 || statusCode === 201 ? 'OK' : 'Error',
      headers: { 'content-type': 'application/json' },
      on: (event: string, handler: (data?: unknown) => void) => {
        if (event === 'data') handler(Buffer.from(bodyStr));
        if (event === 'end') handler();
      },
    };
    callback(res);
    return {
      on: vi.fn(),
      setTimeout: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    };
  };
}

describe('CoraGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cria https.Agent com cert e key decodificados de base64', async () => {
    // Simula token + invoice com sucesso
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok123', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(201, { id: 'inv_abc123' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway();
    await gateway.emitir(dadosPadrao);

    // Verifica que o Agent foi criado com cert/key
    expect(mockAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        cert: expect.any(Buffer),
        key: expect.any(Buffer),
        rejectUnauthorized: true,
      }),
    );
  });

  it('emite com sucesso (token + invoice)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok123', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(201, { id: 'inv_abc123', status: 'PENDING' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway();
    const resultado = await gateway.emitir(dadosPadrao);

    expect(resultado.status).toBe('emitido');
    expect(resultado.idExterno).toBe('inv_abc123');
  });

  it('retorna falha se token falha (sem lançar exceção)', async () => {
    mockRequest.mockImplementationOnce(
      simularResposta(401, { error: 'invalid_client' }),
    );

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway();
    const resultado = await gateway.emitir(dadosPadrao);

    expect(resultado.status).toBe('falha');
    expect(resultado.idExterno).toBe('');
    // Payload de auditoria contém o erro.
    expect(resultado.payloadResposta).toBeDefined();
  });

  it('retorna falha se invoice retorna 400', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok123', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(400, { error: 'invalid_amount' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway();
    const resultado = await gateway.emitir(dadosPadrao);

    expect(resultado.status).toBe('falha');
    expect(resultado.payloadResposta).toEqual(
      expect.objectContaining({ httpStatus: 400 }),
    );
  });

  it('retorna falha se invoice retorna 500', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok123', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(500, { error: 'internal_server_error' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway();
    const resultado = await gateway.emitir(dadosPadrao);

    expect(resultado.status).toBe('falha');
    expect(resultado.payloadResposta).toEqual(
      expect.objectContaining({ httpStatus: 500 }),
    );
  });

  it('monta valor em centavos no payload da invoice', async () => {
    let invoicePayload: Record<string, unknown> = {};
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok123', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(
        (
          _options: unknown,
          callback: (res: { statusCode: number; statusMessage: string; headers: Record<string, string>; on: (event: string, handler: (data?: unknown) => void) => void }) => void,
        ) => {
          const bodyStr = JSON.stringify({ id: 'inv_xyz' });
          const res = {
            statusCode: 201,
            statusMessage: 'Created',
            headers: { 'content-type': 'application/json' },
            on: (event: string, handler: (data?: unknown) => void) => {
              if (event === 'data') handler(Buffer.from(bodyStr));
              if (event === 'end') handler();
            },
          };
          callback(res);
          return {
            on: vi.fn(),
            setTimeout: vi.fn(),
            write: vi.fn((data: string) => {
              invoicePayload = JSON.parse(data);
            }),
            end: vi.fn(),
            destroy: vi.fn(),
          };
        },
      );

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway();
    await gateway.emitir({ ...dadosPadrao, valor: 1234.56 });

    expect(invoicePayload.amount).toBe(123456); // centavos
  });
});
