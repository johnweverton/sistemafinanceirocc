// Testes do branch médico-vs-empresa da rota POST /api/boletos/emitir (Story 10.4c AC1/AC4).
// Cobre: emissão usando os dados da empresa quando execucao_resultados.empresa_id está setado,
// regressão do fluxo médico (deve continuar idêntico), e os casos de erro (empresa/médico
// ausente, resultado sem nenhum dos dois). Idempotência e feature flag já são testadas em
// boleto-emissao.test.ts e se aplicam identicamente aos dois caminhos (mesmo código, steps 2/8).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = {
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  GATEWAY_EMISSAO_HABILITADA: 'true',
  BOLETO_GATEWAY: 'mock',
};

vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockReservarBoleto = vi.fn();
const mockFinalizarBoleto = vi.fn();
const mockBuscarBoletoEmitido = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  reservarBoleto: (...args: unknown[]) => mockReservarBoleto(...args),
  finalizarBoleto: (...args: unknown[]) => mockFinalizarBoleto(...args),
  buscarBoletoEmitido: (...args: unknown[]) => mockBuscarBoletoEmitido(...args),
}));

const mockGatewayEmitir = vi.fn();
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

const mockBuscarEmpresa = vi.fn();
vi.mock('@/server/repositories/empresa-repository', () => ({
  buscarEmpresa: (...args: unknown[]) => mockBuscarEmpresa(...args),
}));

const mockLerConfig = vi.fn();
const mockResolverCondicoes = vi.fn();
vi.mock('@/server/repositories/config-cobranca-repository', () => ({
  lerConfig: (...args: unknown[]) => mockLerConfig(...args),
  resolverCondicoes: (...args: unknown[]) => mockResolverCondicoes(...args),
}));

const cobrancaEmpresaFixture = {
  pagadorTipo: 'PJ' as const,
  pagadorDocumento: '11222333000181',
  pagadorNome: 'MEDISA LTDA',
  email: 'financeiro@medisa.com.br',
  cep: '60000000',
  logradouro: 'Av. Empresarial',
  numero: '500',
  complemento: null,
  bairro: 'Centro',
  cidade: 'Fortaleza',
  uf: 'CE',
};

function empresaFixture(overrides: Partial<{ cobranca: unknown; contaEmissora: string; condicoes: unknown }> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000020',
    nome: 'MEDISA',
    cobranca: cobrancaEmpresaFixture,
    contaEmissora: 'mc' as const,
    condicoes: null,
    regraPreco: null,
    ativo: true,
    ...overrides,
  };
}

function criarRequest(body: unknown): Request {
  return new Request('http://localhost/api/boletos/emitir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function simularResultadoBanco(overrides: Partial<{
  id: string;
  status: string;
  total_valor: number;
  cpf: string;
  nome: string;
  medico_id: string | null;
  empresa_id: string | null;
  execucoes: { competencia: string };
}> = {}) {
  const resultado = {
    id: '00000000-0000-0000-0000-000000000001',
    execucao_id: '00000000-0000-0000-0000-000000000099',
    medico_id: null,
    empresa_id: '00000000-0000-0000-0000-000000000020',
    cpf: '',
    nome: 'MEDISA',
    procedimentos: 0,
    cirurgias: 0,
    guias: 461,
    guias_consolidado: 0,
    subtotais: [],
    total_valor: 2955.01,
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

describe('Rota de emissão — branch médico vs empresa (Story 10.4c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      userId: 'user-empresa-101',
      papel: 'admin',
      colaboradorResponsavel: null,
    });
    mockBuscarBoletoEmitido.mockResolvedValue(null);
    mockBuscarEmpresa.mockResolvedValue(empresaFixture());
    mockLerConfig.mockResolvedValue({
      diasVencimento: 30, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
    });
    mockResolverCondicoes.mockReturnValue({
      diasVencimento: 30, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
    });
    mockGatewayEmitir.mockResolvedValue({
      idExterno: 'MOCK-EMPRESA-1',
      status: 'emitido',
      payloadResposta: { mock: true },
    });
    mockReservarBoleto.mockResolvedValue({
      id: 'reserva-empresa-001',
      execucaoResultadoId: '00000000-0000-0000-0000-000000000001',
      gateway: 'mock',
      idExterno: null,
      status: 'processando',
      emitidoPor: 'user-empresa-101',
      emitidoEm: '2025-06-01T00:00:00Z',
      payloadResposta: null,
    });
    mockFinalizarBoleto.mockResolvedValue({
      id: 'reserva-empresa-001',
      execucaoResultadoId: '00000000-0000-0000-0000-000000000001',
      gateway: 'mock',
      idExterno: 'MOCK-EMPRESA-1',
      status: 'emitido',
      emitidoPor: 'user-empresa-101',
      emitidoEm: '2025-06-01T00:00:00Z',
      payloadResposta: { mock: true },
    });
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
  });

  it('happy path: emite pela empresa quando resultado tem empresa_id, usando cobranca/contaEmissora da empresa', async () => {
    simularResultadoBanco();

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(201);
    // buscarMedico não deve ter sido chamado — o pagador é a empresa.
    expect(mockBuscarEmpresa).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020');

    expect(mockGatewayEmitir).toHaveBeenCalledWith(
      expect.objectContaining({
        valor: 2955.01,
        pagador: expect.objectContaining({
          nome: 'MEDISA LTDA',
          documento: '11222333000181',
          tipo: 'CNPJ',
        }),
      }),
      expect.any(String),
    );
    // Conta emissora usada na factory é a da EMPRESA (não a de nenhum médico individual).
    expect(mockCriarGateway).toHaveBeenCalledWith('mc');
  });

  it('regressão: fluxo por médico permanece inalterado quando resultado tem medico_id (sem empresa_id)', async () => {
    simularResultadoBanco({
      empresa_id: null,
      medico_id: '00000000-0000-0000-0000-000000000010',
      cpf: '11144477735',
      nome: 'Dr. Teste',
      total_valor: 1500,
    });
    mockBuscarMedico.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000010',
      cpf: '11144477735',
      nome: 'Dr. Teste',
      contaEmissora: 'cavalcante_viana' as const,
      cobranca: {
        pagadorTipo: 'PF',
        pagadorDocumento: '11144477735',
        pagadorNome: 'Dr. Teste',
        email: 'dr.teste@exemplo.com',
        cep: '60000000',
        logradouro: 'Rua A',
        numero: '100',
        complemento: null,
        bairro: 'Centro',
        cidade: 'Fortaleza',
        uf: 'CE',
      },
      condicoes: null,
    } as any);

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(201);
    // buscarEmpresa não deve ter sido chamado — o pagador é o médico.
    expect(mockBuscarEmpresa).not.toHaveBeenCalled();
    expect(mockCriarGateway).toHaveBeenCalledWith('cavalcante_viana');
    expect(mockGatewayEmitir).toHaveBeenCalledWith(
      expect.objectContaining({
        pagador: expect.objectContaining({ nome: 'Dr. Teste', tipo: 'CPF' }),
      }),
      expect.any(String),
    );
  });

  it('retorna 404 EMPRESA_NAO_ENCONTRADA quando empresa_id aponta pra empresa inexistente', async () => {
    simularResultadoBanco();
    mockBuscarEmpresa.mockResolvedValue(null);

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.error.code).toBe('EMPRESA_NAO_ENCONTRADA');
    expect(mockGatewayEmitir).not.toHaveBeenCalled();
  });

  it('retorna 422 SEM_MEDICO quando resultado não tem medico_id nem empresa_id', async () => {
    simularResultadoBanco({ empresa_id: null, medico_id: null });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(422);
    const body = await resp.json();
    expect(body.error.code).toBe('SEM_MEDICO');
  });

  it('retorna 422 COBRANCA_INCOMPLETA quando a empresa não tem bloco de cobrança', async () => {
    simularResultadoBanco();
    mockBuscarEmpresa.mockResolvedValue(empresaFixture({ cobranca: null }));

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(422);
    const body = await resp.json();
    expect(body.error.code).toBe('COBRANCA_INCOMPLETA');
    // Mensagem deve usar a nomenclatura "empresa" (crase "da empresa", não "do médico").
    expect(body.error.message).toContain('da empresa');
    expect(mockGatewayEmitir).not.toHaveBeenCalled();
  });

  it('idempotência (409) e feature flag (403) se aplicam igualmente ao caminho empresa', async () => {
    simularResultadoBanco();
    mockBuscarBoletoEmitido.mockResolvedValue({ id: 'boleto-existente-empresa', status: 'emitido' });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req1 = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp1 = await POST(req1, { params: {} });
    expect(resp1.status).toBe(409);
    expect((await resp1.json()).error.code).toBe('BOLETO_JA_EMITIDO');

    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'false';
    const req2 = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp2 = await POST(req2, { params: {} });
    expect(resp2.status).toBe(403);
    expect((await resp2.json()).error.code).toBe('EMISSAO_DESABILITADA');
  });

  it('usa a conta emissora e condições comerciais da empresa (override), não um default global', async () => {
    simularResultadoBanco();
    mockBuscarEmpresa.mockResolvedValue(empresaFixture({
      contaEmissora: 'cavalcante_viana' as const,
      condicoes: { diasVencimento: 15, multaPercent: 2, jurosMesPercent: 1, descontoPercent: null, descontoDias: null },
    }));
    mockResolverCondicoes.mockReturnValue({
      diasVencimento: 15, multaPercent: 2, jurosMesPercent: 1, descontoPercent: null, descontoDias: null,
    });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(201);
    expect(mockCriarGateway).toHaveBeenCalledWith('cavalcante_viana');
    expect(mockResolverCondicoes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ diasVencimento: 15 }),
    );
    expect(mockGatewayEmitir).toHaveBeenCalledWith(
      expect.objectContaining({ condicoes: expect.objectContaining({ diasVencimento: 15 }) }),
      expect.any(String),
    );
  });
});
