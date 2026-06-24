// Testes da lógica de emissão de boleto (regras de negócio da rota POST /api/boletos/emitir).
// Testa os gates sem rede: feature flag, status do resultado, idempotência, happy path.
// Mocks: env, requireRole, repository, gateway factory.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de dependências
// ---------------------------------------------------------------------------

const mockEnv = {
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  GATEWAY_EMISSAO_HABILITADA: 'false', // default: desligada
  BOLETO_GATEWAY: 'mock',
};

vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockCriarBoleto = vi.fn();
const mockBuscarBoletoEmitido = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  criarBoleto: (...args: unknown[]) => mockCriarBoleto(...args),
  buscarBoletoEmitido: (...args: unknown[]) => mockBuscarBoletoEmitido(...args),
}));

const mockGatewayEmitir = vi.fn();
vi.mock('@/server/gateway/boleto-gateway-factory', () => ({
  criarBoletoGateway: () => ({
    gateway: { emitir: mockGatewayEmitir },
    nome: 'mock' as const,
  }),
}));

const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockSupabaseFrom }),
}));

// ---------------------------------------------------------------------------
// Helper para simular o handler da rota
// ---------------------------------------------------------------------------

/** Simula uma Request com JSON body. */
function criarRequest(body: unknown): Request {
  return new Request('http://localhost/api/boletos/emitir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Simula resultado no banco. */
function simularResultadoBanco(overrides: Partial<{
  id: string;
  status: string;
  total_valor: number;
  cpf: string;
  nome: string;
  execucoes: { competencia: string };
}> = {}) {
  const resultado = {
    id: '00000000-0000-0000-0000-000000000001',
    execucao_id: '00000000-0000-0000-0000-000000000099',
    medico_id: '00000000-0000-0000-0000-000000000010',
    cpf: '12345678901',
    nome: 'Dr. Teste',
    procedimentos: 10,
    cirurgias: 2,
    guias: 8,
    guias_consolidado: 6,
    subtotais: [],
    total_valor: 1500,
    status: 'ok',
    alertas: [],
    execucoes: { competencia: '2025-06' },
    ...overrides,
  };
  mockSupabaseFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: resultado, error: null }),
      }),
    }),
  });
  return resultado;
}

describe('Lógica de emissão de boleto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      userId: 'user-123',
      papel: 'admin',
      colaboradorResponsavel: null,
    });
    mockBuscarBoletoEmitido.mockResolvedValue(null);
    mockGatewayEmitir.mockResolvedValue({
      idExterno: 'MOCK-123',
      status: 'emitido',
      payloadResposta: { mock: true },
    });
    mockCriarBoleto.mockResolvedValue({
      id: 'boleto-001',
      execucaoResultadoId: '00000000-0000-0000-0000-000000000001',
      gateway: 'mock',
      idExterno: 'MOCK-123',
      status: 'emitido',
      emitidoPor: 'user-123',
      emitidoEm: '2025-06-01T00:00:00Z',
      payloadResposta: { mock: true },
    });
    // Default: flag desligada
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'false';
  });

  it('retorna 403 quando feature flag está desligada', async () => {
    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(403);
    const body = await resp.json();
    expect(body.error.code).toBe('EMISSAO_DESABILITADA');
  });

  it('retorna 400 quando resultado tem status alerta', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco({ status: 'alerta' });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe('STATUS_INVALIDO');
  });

  it('retorna 400 quando resultado tem status sem_dados', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco({ status: 'sem_dados' });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe('STATUS_INVALIDO');
  });

  it('retorna 409 quando já existe boleto emitido (idempotência)', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco();
    mockBuscarBoletoEmitido.mockResolvedValue({
      id: 'boleto-existente',
      status: 'emitido',
    });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.error.code).toBe('BOLETO_JA_EMITIDO');
  });

  it('happy path: emite boleto sobre resultado ok e retorna 201', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco();

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body.boleto.status).toBe('emitido');
    expect(body.boleto.gateway).toBe('mock');

    // Verificar que o gateway foi chamado com dados corretos.
    expect(mockGatewayEmitir).toHaveBeenCalledWith(
      expect.objectContaining({
        cpfMedico: '12345678901',
        nomeMedico: 'Dr. Teste',
        competencia: '2025-06',
        valor: 1500,
      }),
    );

    // Verificar que o boleto foi persistido (auditoria).
    expect(mockCriarBoleto).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'mock',
        status: 'emitido',
        emitidoPor: 'user-123',
      }),
    );
  });

  it('persiste boleto mesmo quando gateway retorna falha (auditoria)', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco();
    mockGatewayEmitir.mockResolvedValue({
      idExterno: '',
      status: 'falha',
      payloadResposta: { error: 'gateway_error' },
    });
    mockCriarBoleto.mockResolvedValue({
      id: 'boleto-falha',
      status: 'falha',
      gateway: 'mock',
      idExterno: null,
      emitidoPor: 'user-123',
      emitidoEm: '2025-06-01T00:00:00Z',
      payloadResposta: { error: 'gateway_error' },
    });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    // 502 para falha do gateway (não 500, que seria erro interno).
    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.boleto.status).toBe('falha');

    // Auditoria: boleto com falha foi persistido.
    expect(mockCriarBoleto).toHaveBeenCalled();
  });
});
