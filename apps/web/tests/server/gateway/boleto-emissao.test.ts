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
// Story 7.2: captura a conta emissora passada à factory.
const mockCriarGateway = vi.fn(() => ({
  gateway: { emitir: mockGatewayEmitir },
  nome: 'mock' as const,
}));
vi.mock('@/server/gateway/boleto-gateway-factory', () => ({
  criarBoletoGateway: (...args: unknown[]) => mockCriarGateway(...(args as [])),
}));

const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockSupabaseFrom }),
}));

const mockBuscarMedico = vi.fn();
vi.mock('@/server/repositories/medico-repository', () => ({
  buscarMedico: (...args: unknown[]) => mockBuscarMedico(...args),
}));

const mockLerConfig = vi.fn();
const mockResolverCondicoes = vi.fn();
vi.mock('@/server/repositories/config-cobranca-repository', () => ({
  lerConfig: (...args: unknown[]) => mockLerConfig(...args),
  resolverCondicoes: (...args: unknown[]) => mockResolverCondicoes(...args),
}));

/** Bloco de cobrança completo (passa cobrancaCompleta). */
const cobrancaCompletaFixture = {
  pagadorTipo: 'PF' as const,
  pagadorDocumento: '12345678901',
  pagadorNome: 'Dr. Teste',
  email: 'dr.teste@exemplo.com',
  cep: '60000000',
  logradouro: 'Rua A',
  numero: '100',
  complemento: null,
  bairro: 'Centro',
  cidade: 'Fortaleza',
  uf: 'CE',
};

/** Médico completo para os testes de emissão. */
function medicoFixture(cobranca: unknown = cobrancaCompletaFixture) {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    cpf: '12345678901',
    nome: 'Dr. Teste',
    contaEmissora: 'mc' as const,
    cobranca,
    condicoes: null,
  };
}

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
  medico_id: string | null;
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
    mockBuscarMedico.mockResolvedValue(medicoFixture());
    mockLerConfig.mockResolvedValue({
      diasVencimento: 30, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
    });
    mockResolverCondicoes.mockReturnValue({
      diasVencimento: 30, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
    });
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

    // Verificar que o gateway foi chamado com o pagador completo (novo contrato).
    expect(mockGatewayEmitir).toHaveBeenCalledWith(
      expect.objectContaining({
        competencia: '2025-06',
        valor: 1500,
        pagador: expect.objectContaining({
          nome: 'Dr. Teste',
          documento: '12345678901',
          tipo: 'CPF',
          email: 'dr.teste@exemplo.com',
          endereco: expect.objectContaining({ cep: '60000000', uf: 'CE' }),
        }),
        condicoes: expect.objectContaining({ diasVencimento: 30 }),
      }),
    );

    // Verificar que o boleto foi persistido (auditoria) com o vencimento (Story 4.2).
    expect(mockCriarBoleto).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'mock',
        status: 'emitido',
        emitidoPor: 'user-123',
        vencimento: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it('happy path: emite boleto com cobrança MÍNIMA (só documento+nome, sem email/endereço)', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco();
    mockBuscarMedico.mockResolvedValue(medicoFixture({
      pagadorTipo: 'PF' as const,
      pagadorDocumento: '12345678901',
      pagadorNome: 'Dr. Teste',
      email: '',
      cep: '',
      logradouro: '',
      numero: '',
      complemento: null,
      bairro: '',
      cidade: '',
      uf: '',
    }));

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(201);

    // Payload pro gateway não deve conter email nem endereço parcial.
    expect(mockGatewayEmitir).toHaveBeenCalledWith(
      expect.objectContaining({
        pagador: expect.objectContaining({
          nome: 'Dr. Teste',
          documento: '12345678901',
          tipo: 'CPF',
          email: undefined,
          endereco: undefined,
        }),
      }),
    );
  });

  it('retorna 422 COBRANCA_INCOMPLETA quando o médico não tem cobrança completa', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco();
    mockBuscarMedico.mockResolvedValue(medicoFixture(null)); // sem bloco de cobrança

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(422);
    const body = await resp.json();
    expect(body.error.code).toBe('COBRANCA_INCOMPLETA');
    // Não deve chamar o gateway (falha cedo).
    expect(mockGatewayEmitir).not.toHaveBeenCalled();
  });

  it('retorna 422 SEM_MEDICO quando o resultado não tem medico_id', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco({ medico_id: null });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(422);
    const body = await resp.json();
    expect(body.error.code).toBe('SEM_MEDICO');
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

  it('emite pela conta emissora do médico e grava a conta no boleto (Story 7.2)', async () => {
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
    simularResultadoBanco();
    mockBuscarMedico.mockResolvedValue({ ...medicoFixture(), contaEmissora: 'cavalcante_viana' });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(201);
    // Factory recebe a conta do MÉDICO (beneficiário correto do boleto).
    expect(mockCriarGateway).toHaveBeenCalledWith('cavalcante_viana');
    // Desnormalização: o boleto persiste a conta que o emitiu (arquitetura §3).
    expect(mockCriarBoleto).toHaveBeenCalledWith(
      expect.objectContaining({ contaEmissora: 'cavalcante_viana' }),
    );
  });
});
