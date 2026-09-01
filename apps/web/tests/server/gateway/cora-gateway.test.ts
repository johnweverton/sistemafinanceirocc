// Testes do CoraGateway — mocks de https (sem certificado real, sem rede).
// Verifica que o gateway:
//   - Cria https.Agent com cert/key corretos.
//   - Obtém token OAuth2 antes de emitir.
//   - Trata erros da API sem lançar (retorna status 'falha').
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DadosEmissaoBoleto } from '@cobranca/shared';

// Story 7.2: o gateway não lê mais env — credenciais são injetadas no construtor
// (uma instância = uma conta emissora). Mesmos valores fake de antes.
const CRED_TESTE = {
  certBase64: Buffer.from('FAKE-CERT-PEM').toString('base64'),
  keyBase64: Buffer.from('FAKE-KEY-PEM').toString('base64'),
  apiUrl: 'https://api.test.cora.com.br',
  clientId: 'test-client-id',
  webhookSecret: null,
};

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
  competencia: '2025-06',
  valor: 1500.0,
  pagador: {
    nome: 'Dr. Teste',
    documento: '12345678901',
    tipo: 'CPF',
    email: 'dr.teste@exemplo.com',
    endereco: {
      cep: '60000000',
      logradouro: 'Rua A',
      numero: '100',
      complemento: 'Sala 2',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      uf: 'CE',
    },
  },
  condicoes: {
    diasVencimento: 30,
    multaPercent: null,
    jurosMesPercent: null,
    descontoPercent: null,
    modoVencimento: 'dias_corridos',
    diaFixoVencimento: null,
    descontoDias: null,
  },
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
    const gateway = new CoraGateway(CRED_TESTE);
    await gateway.emitir(dadosPadrao, 'idem-key-1');

    // Verifica que o Agent foi criado com cert/key
    expect(mockAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        cert: expect.any(Buffer),
        key: expect.any(Buffer),
        rejectUnauthorized: true,
      }),
    );
  });

  it('usa POST /v2/invoices com header Idempotency-Key = id da reserva (migration 0037 — determinística, não randomUUID() por tentativa)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok123', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(201, { id: 'inv_abc123' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway(CRED_TESTE);
    await gateway.emitir(dadosPadrao, 'reserva-uuid-fixa-123');

    // 1ª chamada = token; 2ª = invoice. Path v1 (/invoices) devolve 404 em produção.
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const invoiceOptions = mockRequest.mock.calls[1]?.[0] as {
      path: string;
      headers: Record<string, string>;
    };
    expect(invoiceOptions.path).toBe('/v2/invoices');
    expect(invoiceOptions.headers['Idempotency-Key']).toBe('reserva-uuid-fixa-123');
  });

  it('emite com sucesso (token + invoice)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok123', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(201, { id: 'inv_abc123', status: 'PENDING' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway(CRED_TESTE);
    const resultado = await gateway.emitir(dadosPadrao, 'idem-key-teste');

    expect(resultado.status).toBe('emitido');
    expect(resultado.idExterno).toBe('inv_abc123');
  });

  it('retorna falha se token falha (sem lançar exceção)', async () => {
    mockRequest.mockImplementationOnce(
      simularResposta(401, { error: 'invalid_client' }),
    );

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway(CRED_TESTE);
    const resultado = await gateway.emitir(dadosPadrao, 'idem-key-teste');

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
    const gateway = new CoraGateway(CRED_TESTE);
    const resultado = await gateway.emitir(dadosPadrao, 'idem-key-teste');

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
    const gateway = new CoraGateway(CRED_TESTE);
    const resultado = await gateway.emitir(dadosPadrao, 'idem-key-teste');

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
    const gateway = new CoraGateway(CRED_TESTE);
    await gateway.emitir({ ...dadosPadrao, valor: 1234.56 }, 'idem-key-teste');

    expect(invoicePayload.amount).toBe(123456); // centavos

    // customer completo: nome, email, documento tipado e endereço mapeado.
    const customer = invoicePayload.customer as Record<string, any>;
    expect(customer.name).toBe('Dr. Teste');
    expect(customer.email).toBe('dr.teste@exemplo.com');
    expect(customer.document).toEqual({ identity: '12345678901', type: 'CPF' });
    expect(customer.address).toEqual(
      expect.objectContaining({
        street: 'Rua A',
        number: '100',
        district: 'Centro',
        city: 'Fortaleza',
        state: 'CE',
        zip_code: '60000000',
        complement: 'Sala 2',
      }),
    );
    // sem multa/juros/desconto → payment_terms só com due_date.
    const terms = invoicePayload.payment_terms as Record<string, unknown>;
    expect(terms.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(terms.fine).toBeUndefined();
    expect(terms.interest).toBeUndefined();
    expect(terms.discount).toBeUndefined();
  });

  it('inclui a quantidade de guias na descrição do serviço quando informada (pedido do dono, 2026-08-06)', async () => {
    let invoicePayload: Record<string, unknown> = {};
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(
        (
          _o: unknown,
          callback: (res: { statusCode: number; statusMessage: string; headers: Record<string, string>; on: (event: string, handler: (data?: unknown) => void) => void }) => void,
        ) => {
          const res = {
            statusCode: 201,
            statusMessage: 'Created',
            headers: { 'content-type': 'application/json' },
            on: (event: string, handler: (data?: unknown) => void) => {
              if (event === 'data') handler(Buffer.from(JSON.stringify({ id: 'inv_guias' })));
              if (event === 'end') handler();
            },
          };
          callback(res);
          return {
            on: vi.fn(),
            setTimeout: vi.fn(),
            write: vi.fn((data: string) => { invoicePayload = JSON.parse(data); }),
            end: vi.fn(),
            destroy: vi.fn(),
          };
        },
      );

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway(CRED_TESTE);
    await gateway.emitir({ ...dadosPadrao, quantidadeGuias: 42 }, 'idem-key-teste');

    const services = invoicePayload.services as { name: string; amount: number }[];
    expect(services[0]?.name).toBe('Cobrança competência 2025-06 — 42 guias');
  });

  it('não menciona guias na descrição quando quantidadeGuias é null/0/ausente (ex.: cliente contábil)', async () => {
    let invoicePayload: Record<string, unknown> = {};
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(
        (
          _o: unknown,
          callback: (res: { statusCode: number; statusMessage: string; headers: Record<string, string>; on: (event: string, handler: (data?: unknown) => void) => void }) => void,
        ) => {
          const res = {
            statusCode: 201,
            statusMessage: 'Created',
            headers: { 'content-type': 'application/json' },
            on: (event: string, handler: (data?: unknown) => void) => {
              if (event === 'data') handler(Buffer.from(JSON.stringify({ id: 'inv_sem_guias' })));
              if (event === 'end') handler();
            },
          };
          callback(res);
          return {
            on: vi.fn(),
            setTimeout: vi.fn(),
            write: vi.fn((data: string) => { invoicePayload = JSON.parse(data); }),
            end: vi.fn(),
            destroy: vi.fn(),
          };
        },
      );

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway(CRED_TESTE);
    await gateway.emitir({ ...dadosPadrao, quantidadeGuias: null }, 'idem-key-teste');

    const services = invoicePayload.services as { name: string; amount: number }[];
    expect(services[0]?.name).toBe('Cobrança competência 2025-06');
  });

  it('omite email e address do customer quando o pagador não tem (Épico 6: opcionais)', async () => {
    let invoicePayload: Record<string, unknown> = {};
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok123', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(
        (
          _options: unknown,
          callback: (res: { statusCode: number; statusMessage: string; headers: Record<string, string>; on: (event: string, handler: (data?: unknown) => void) => void }) => void,
        ) => {
          const bodyStr = JSON.stringify({ id: 'inv_min' });
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
    const gateway = new CoraGateway(CRED_TESTE);
    await gateway.emitir(
      {
        ...dadosPadrao,
        pagador: { nome: 'Dr. Teste', documento: '12345678901', tipo: 'CPF' },
      },
      'idem-key-teste',
    );

    const customer = invoicePayload.customer as Record<string, any>;
    expect(customer.name).toBe('Dr. Teste');
    expect(customer.document).toEqual({ identity: '12345678901', type: 'CPF' });
    expect('email' in customer).toBe(false);
    expect('address' in customer).toBe(false);
  });

  it('document.type = CNPJ quando pagador é PJ e inclui multa/juros/desconto', async () => {
    let invoicePayload: Record<string, unknown> = {};
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(
        (
          _o: unknown,
          callback: (res: { statusCode: number; statusMessage: string; headers: Record<string, string>; on: (event: string, handler: (data?: unknown) => void) => void }) => void,
        ) => {
          const res = {
            statusCode: 201,
            statusMessage: 'Created',
            headers: { 'content-type': 'application/json' },
            on: (event: string, handler: (data?: unknown) => void) => {
              if (event === 'data') handler(Buffer.from(JSON.stringify({ id: 'inv_pj' })));
              if (event === 'end') handler();
            },
          };
          callback(res);
          return {
            on: vi.fn(),
            setTimeout: vi.fn(),
            write: vi.fn((data: string) => { invoicePayload = JSON.parse(data); }),
            end: vi.fn(),
            destroy: vi.fn(),
          };
        },
      );

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway(CRED_TESTE);
    await gateway.emitir(
      {
        ...dadosPadrao,
        pagador: { ...dadosPadrao.pagador, tipo: 'CNPJ', documento: '12345678000199' },
        condicoes: {
          diasVencimento: 15, multaPercent: 2, jurosMesPercent: 1, descontoPercent: 5, descontoDias: 3,
          modoVencimento: 'dias_corridos', diaFixoVencimento: null,
        },
      },
      'idem-key-teste',
    );

    const customer = invoicePayload.customer as Record<string, any>;
    expect(customer.document).toEqual({ identity: '12345678000199', type: 'CNPJ' });
    const terms = invoicePayload.payment_terms as Record<string, any>;
    // Percentuais SEMPRE em rate/PERCENT — fine.amount é centavos fixos (bug de produção 2026-07-10).
    expect(terms.fine).toEqual({ rate: 2 });
    expect(terms.interest).toEqual({ rate: 1 });
    expect(terms.discount).toEqual({ type: 'PERCENT', value: 5 });
  });

  it('não inclui payment_forms por padrão (EMISSAO_PIX_HABILITADA desligada) — só código de barras', async () => {
    delete process.env.EMISSAO_PIX_HABILITADA;
    let invoicePayload: Record<string, unknown> = {};
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(
        (
          _o: unknown,
          callback: (res: { statusCode: number; statusMessage: string; headers: Record<string, string>; on: (event: string, handler: (data?: unknown) => void) => void }) => void,
        ) => {
          const res = {
            statusCode: 201,
            statusMessage: 'Created',
            headers: { 'content-type': 'application/json' },
            on: (event: string, handler: (data?: unknown) => void) => {
              if (event === 'data') handler(Buffer.from(JSON.stringify({ id: 'inv_sem_pix' })));
              if (event === 'end') handler();
            },
          };
          callback(res);
          return {
            on: vi.fn(),
            setTimeout: vi.fn(),
            write: vi.fn((data: string) => { invoicePayload = JSON.parse(data); }),
            end: vi.fn(),
            destroy: vi.fn(),
          };
        },
      );

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const gateway = new CoraGateway(CRED_TESTE);
    await gateway.emitir(dadosPadrao, 'idem-key-teste');

    expect('payment_forms' in invoicePayload).toBe(false);
  });

  it('inclui payment_forms BANK_SLIP+PIX quando EMISSAO_PIX_HABILITADA=true (boleto híbrido, achado 2026-08-05)', async () => {
    process.env.EMISSAO_PIX_HABILITADA = 'true';
    let invoicePayload: Record<string, unknown> = {};
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(
        (
          _o: unknown,
          callback: (res: { statusCode: number; statusMessage: string; headers: Record<string, string>; on: (event: string, handler: (data?: unknown) => void) => void }) => void,
        ) => {
          const res = {
            statusCode: 201,
            statusMessage: 'Created',
            headers: { 'content-type': 'application/json' },
            on: (event: string, handler: (data?: unknown) => void) => {
              if (event === 'data') handler(Buffer.from(JSON.stringify({ id: 'inv_com_pix' })));
              if (event === 'end') handler();
            },
          };
          callback(res);
          return {
            on: vi.fn(),
            setTimeout: vi.fn(),
            write: vi.fn((data: string) => { invoicePayload = JSON.parse(data); }),
            end: vi.fn(),
            destroy: vi.fn(),
          };
        },
      );

    try {
      const { CoraGateway } = await import('@/server/gateway/cora-gateway');
      const gateway = new CoraGateway(CRED_TESTE);
      await gateway.emitir(dadosPadrao, 'idem-key-teste');

      expect(invoicePayload.payment_forms).toEqual(['BANK_SLIP', 'PIX']);
    } finally {
      delete process.env.EMISSAO_PIX_HABILITADA;
    }
  });
});

describe('CoraGateway.cancelar (Story 6.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('DELETE com 200 → sucesso=true', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(200, { id: 'inv_1', status: 'CANCELLED' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const r = await new CoraGateway(CRED_TESTE).cancelar('inv_1');
    expect(r.sucesso).toBe(true);
  });

  it('DELETE com 204 No Content → sucesso=true (Response proíbe corpo em 204 — crash em produção 2026-07-10)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(204, ''));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const r = await new CoraGateway(CRED_TESTE).cancelar('inv_204');
    expect(r.sucesso).toBe(true);
    expect(r.payloadResposta).toBeNull();
  });

  it('corpo vazio no 200 → sucesso=true (payload null, sem lançar)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(200, ''));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const r = await new CoraGateway(CRED_TESTE).cancelar('inv_1');
    expect(r.sucesso).toBe(true);
    expect(r.payloadResposta).toBeNull();
  });

  it('erro 400 da Cora (ex.: boleto pago) → sucesso=false com payload de auditoria', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(400, { error: 'invoice_already_paid' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const r = await new CoraGateway(CRED_TESTE).cancelar('inv_pago');
    expect(r.sucesso).toBe(false);
    expect(r.payloadResposta).toEqual(
      expect.objectContaining({ httpStatus: 400 }),
    );
  });

  it('erro de rede → sucesso=false (nunca lança)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce((_options: unknown, _cb: unknown) => ({
        on: (event: string, handler: (err: Error) => void) => {
          if (event === 'error') handler(new Error('ECONNRESET'));
        },
        setTimeout: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const r = await new CoraGateway(CRED_TESTE).cancelar('inv_x');
    expect(r.sucesso).toBe(false);
    expect(r.payloadResposta).toEqual(
      expect.objectContaining({ error: expect.stringContaining('ECONNRESET') }),
    );
  });
});

describe('CoraGateway.consultarInvoice (Story 4.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mapeia invoice PAID → paid com valor e data', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(200, { id: 'inv_1', status: 'PAID', total_paid: 150000, paid_at: '2026-06-15T12:00:00Z' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const r = await new CoraGateway(CRED_TESTE).consultarInvoice('inv_1');
    expect(r.status).toBe('paid');
    expect(r.valorPago).toBe(1500);
    expect(r.pagoEm).toBe('2026-06-15T12:00:00Z');
  });

  it('mapeia invoice CANCELLED → canceled', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(200, { id: 'inv_1', status: 'CANCELLED' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const r = await new CoraGateway(CRED_TESTE).consultarInvoice('inv_1');
    expect(r.status).toBe('canceled');
  });

  it('erro/404 → status unknown (não lança)', async () => {
    mockRequest
      .mockImplementationOnce(simularResposta(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockImplementationOnce(simularResposta(404, { error: 'not_found' }));

    const { CoraGateway } = await import('@/server/gateway/cora-gateway');
    const r = await new CoraGateway(CRED_TESTE).consultarInvoice('inv_x');
    expect(r.status).toBe('unknown');
    expect(r.valorPago).toBeNull();
  });
});
