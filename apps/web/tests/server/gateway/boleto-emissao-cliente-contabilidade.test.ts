// Testes do branch cliente contábil da rota POST /api/boletos/emitir (Story 11.3 AC6). Mesmo
// padrão de boleto-emissao-empresa.test.ts (Story 10.4c) — emissão usando os dados do cliente
// contábil quando execucao_resultados.cliente_contabilidade_id está setado.
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

const mockBuscarClienteContabilidade = vi.fn();
vi.mock('@/server/repositories/cliente-contabilidade-repository', () => ({
  buscarClienteContabilidade: (...args: unknown[]) => mockBuscarClienteContabilidade(...args),
}));

const mockLerConfig = vi.fn();
const mockResolverCondicoes = vi.fn();
vi.mock('@/server/repositories/config-cobranca-repository', () => ({
  lerConfig: (...args: unknown[]) => mockLerConfig(...args),
  resolverCondicoes: (...args: unknown[]) => mockResolverCondicoes(...args),
}));

const cobrancaClienteFixture = {
  pagadorTipo: 'PJ' as const,
  pagadorDocumento: '11222333000181',
  pagadorNome: 'Padaria Bom Pão Ltda',
  email: 'financeiro@padaria.com.br',
  cep: '60000000',
  logradouro: 'Av. Comercial',
  numero: '200',
  complemento: null,
  bairro: 'Centro',
  cidade: 'Fortaleza',
  uf: 'CE',
};

function clienteFixture(
  overrides: Partial<{ cobranca: unknown; contaEmissora: string; condicoes: unknown }> = {},
) {
  return {
    id: '00000000-0000-0000-0000-000000000030',
    nome: 'Padaria Bom Pão Ltda',
    regimeTributario: 'simples_nacional' as const,
    modoCobranca: 'faixa_faturamento' as const,
    cobranca: cobrancaClienteFixture,
    contaEmissora: 'mc' as const,
    condicoes: null,
    regraPreco: null,
    adicionalAtivo: false,
    adicionalValor: null,
    adicionalIntervaloMeses: null,
    adicionalCompetenciaBase: null,
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

function simularResultadoBanco(
  overrides: Partial<{
    id: string;
    status: string;
    total_valor: number;
    cpf: string;
    nome: string;
    medico_id: string | null;
    empresa_id: string | null;
    cliente_contabilidade_id: string | null;
    execucoes: { competencia: string };
  }> = {},
) {
  const resultado = {
    id: '00000000-0000-0000-0000-000000000001',
    execucao_id: '00000000-0000-0000-0000-000000000099',
    medico_id: null,
    empresa_id: null,
    cliente_contabilidade_id: '00000000-0000-0000-0000-000000000030',
    cpf: '',
    nome: 'Padaria Bom Pão Ltda',
    procedimentos: 0,
    cirurgias: 0,
    guias: null,
    guias_consolidado: 0,
    subtotais: [],
    total_valor: 250,
    status: 'ok',
    alertas: [],
    execucoes: { competencia: '2026-07' },
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

describe('Rota de emissão — branch cliente contábil (Story 11.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      userId: 'user-cc-101',
      papel: 'admin',
      colaboradorResponsavel: null,
    });
    mockBuscarBoletoEmitido.mockResolvedValue(null);
    mockBuscarClienteContabilidade.mockResolvedValue(clienteFixture());
    mockLerConfig.mockResolvedValue({
      diasVencimento: 30, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
    });
    mockResolverCondicoes.mockReturnValue({
      diasVencimento: 30, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
    });
    mockGatewayEmitir.mockResolvedValue({
      idExterno: 'MOCK-CC-1',
      status: 'emitido',
      payloadResposta: { mock: true },
    });
    mockReservarBoleto.mockResolvedValue({
      id: 'reserva-cc-001',
      execucaoResultadoId: '00000000-0000-0000-0000-000000000001',
      gateway: 'mock',
      idExterno: null,
      status: 'processando',
      emitidoPor: 'user-cc-101',
      emitidoEm: '2026-07-01T00:00:00Z',
      payloadResposta: null,
    });
    mockFinalizarBoleto.mockResolvedValue({
      id: 'reserva-cc-001',
      execucaoResultadoId: '00000000-0000-0000-0000-000000000001',
      gateway: 'mock',
      idExterno: 'MOCK-CC-1',
      status: 'emitido',
      emitidoPor: 'user-cc-101',
      emitidoEm: '2026-07-01T00:00:00Z',
      payloadResposta: { mock: true },
    });
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
  });

  it('happy path: emite pelo cliente contábil quando resultado tem cliente_contabilidade_id', async () => {
    simularResultadoBanco();

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(201);
    expect(mockBuscarClienteContabilidade).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000030');
    expect(mockBuscarMedico).not.toHaveBeenCalled();
    expect(mockBuscarEmpresa).not.toHaveBeenCalled();

    expect(mockGatewayEmitir).toHaveBeenCalledWith(
      expect.objectContaining({
        valor: 250,
        pagador: expect.objectContaining({
          nome: 'Padaria Bom Pão Ltda',
          documento: '11222333000181',
          tipo: 'CNPJ',
        }),
      }),
      expect.any(String),
    );
    expect(mockCriarGateway).toHaveBeenCalledWith('mc');
  });

  it('retorna 404 CLIENTE_CONTABILIDADE_NAO_ENCONTRADO quando o cliente não existe', async () => {
    simularResultadoBanco();
    mockBuscarClienteContabilidade.mockResolvedValue(null);

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.error.code).toBe('CLIENTE_CONTABILIDADE_NAO_ENCONTRADO');
    expect(mockGatewayEmitir).not.toHaveBeenCalled();
  });

  it('retorna 422 COBRANCA_INCOMPLETA quando o cliente não tem bloco de cobrança', async () => {
    simularResultadoBanco();
    mockBuscarClienteContabilidade.mockResolvedValue(clienteFixture({ cobranca: null }));

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(422);
    const body = await resp.json();
    expect(body.error.code).toBe('COBRANCA_INCOMPLETA');
    expect(body.error.message).toContain('do cliente contábil');
    expect(mockGatewayEmitir).not.toHaveBeenCalled();
  });

  it('idempotência (409) se aplica igualmente ao caminho cliente contábil', async () => {
    simularResultadoBanco();
    mockBuscarBoletoEmitido.mockResolvedValue({ id: 'boleto-existente-cc', status: 'emitido' });

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });
    expect(resp.status).toBe(409);
    expect((await resp.json()).error.code).toBe('BOLETO_JA_EMITIDO');
  });

  it('usa a conta emissora do cliente contábil (override), não um default global', async () => {
    simularResultadoBanco();
    mockBuscarClienteContabilidade.mockResolvedValue(
      clienteFixture({ contaEmissora: 'cavalcante_viana' as const }),
    );

    const { POST } = await import('@/app/api/boletos/emitir/route');
    const req = criarRequest({ execucaoResultadoId: '00000000-0000-0000-0000-000000000001' });
    const resp = await POST(req, { params: {} });

    expect(resp.status).toBe(201);
    expect(mockCriarGateway).toHaveBeenCalledWith('cavalcante_viana');
  });

  it('regressão: fluxo por médico permanece inalterado (sem tocar cliente contábil)', async () => {
    simularResultadoBanco({
      cliente_contabilidade_id: null,
      medico_id: '00000000-0000-0000-0000-000000000010',
      cpf: '11144477735',
      nome: 'Dr. Teste',
      total_valor: 1500,
    });
    mockBuscarMedico.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000010',
      cpf: '11144477735',
      nome: 'Dr. Teste',
      contaEmissora: 'mc' as const,
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
    expect(mockBuscarClienteContabilidade).not.toHaveBeenCalled();
  });
});
