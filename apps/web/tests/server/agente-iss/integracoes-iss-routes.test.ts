// Rotas de máquina do agente ISS (Story 13.1, AC 2–4) — deps mockadas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/lib/api-error';

const mockRequireToken = vi.fn();
vi.mock('@/server/auth/require-agente-token', () => ({
  requireAgenteIssToken: (...a: unknown[]) => mockRequireToken(...a),
}));

const mockListarAlvos = vi.fn();
const mockRegistrar = vi.fn();
vi.mock('@/server/repositories/iss-captura-repository', () => ({
  listarAlvosIss: (...a: unknown[]) => mockListarAlvos(...a),
  registrarExecucaoIss: (...a: unknown[]) => mockRegistrar(...a),
}));

import { GET } from '@/app/api/integracoes/iss/alvos/route';
import { POST } from '@/app/api/integracoes/iss/execucoes/route';

const params = { params: {} as Record<string, never> };
const CLIENTE = '11111111-1111-4111-8111-111111111111';

function execucaoValida(overrides: Record<string, unknown> = {}) {
  return {
    competencia: '2026-08',
    iniciadoEm: '2026-09-21T10:00:00-03:00',
    finalizadoEm: '2026-09-21T10:40:00-03:00',
    maquina: 'ESCRITORIO-01',
    versaoAgente: '0.1.0',
    capturas: [
      {
        clienteContabilidadeId: CLIENTE,
        status: 'capturado',
        valorServicosPrestados: 618.84,
        quantidadeNotas: 3,
        situacaoIss: 'Fechada - Retificadora(1)',
        competenciaFechada: true,
        inscricaoMunicipal: '0211519-0',
        razaoSocialIss: 'CARMEM GLISSE CAVALCANTE LTDA',
        mensagemErro: null,
        capturadoEm: '2026-09-21T10:01:00-03:00',
      },
    ],
    ciencias: [],
    ...overrides,
  };
}

function post(corpo: unknown) {
  return POST(
    new Request('http://test/api/integracoes/iss/execucoes', {
      method: 'POST',
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }),
    params,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireToken.mockImplementation(() => undefined);
});

describe('GET /api/integracoes/iss/alvos', () => {
  it('repassa a competência e devolve os alvos', async () => {
    mockListarAlvos.mockResolvedValue({ competencia: '2026-08', alvos: [], semDocumento: [] });
    const res = await GET(new Request('http://test/api/integracoes/iss/alvos?competencia=2026-08'), params);
    expect(res.status).toBe(200);
    expect(mockListarAlvos).toHaveBeenCalledWith('2026-08');
  });

  it('competência inválida → 422', async () => {
    const res = await GET(new Request('http://test/api/integracoes/iss/alvos?competencia=08/2026'), params);
    expect(res.status).toBe(422);
    expect(mockListarAlvos).not.toHaveBeenCalled();
  });

  it('token inválido → 401 sem consultar nada', async () => {
    mockRequireToken.mockImplementation(() => {
      throw new ApiError(401, 'x', 'UNAUTHORIZED');
    });
    const res = await GET(new Request('http://test/api/integracoes/iss/alvos?competencia=2026-08'), params);
    expect(res.status).toBe(401);
    expect(mockListarAlvos).not.toHaveBeenCalled();
  });
});

describe('POST /api/integracoes/iss/execucoes', () => {
  it('payload válido → 201 com o resultado do repositório', async () => {
    mockRegistrar.mockResolvedValue({ execucaoId: 'e1', competencia: '2026-08', totais: {}, comAlerta: 0 });
    const res = await post(execucaoValida());
    expect(res.status).toBe(201);
    expect(mockRegistrar).toHaveBeenCalledTimes(1);
    expect((await res.json()).execucaoId).toBe('e1');
  });

  it("status 'capturado' sem valor → 422", async () => {
    const corpo = execucaoValida();
    corpo.capturas[0]!.valorServicosPrestados = null as unknown as number;
    const res = await post(corpo);
    expect(res.status).toBe(422);
    expect(mockRegistrar).not.toHaveBeenCalled();
  });

  it('valor negativo → 422', async () => {
    const corpo = execucaoValida();
    corpo.capturas[0]!.valorServicosPrestados = -1;
    expect((await post(corpo)).status).toBe(422);
  });

  it('cliente repetido na mesma execução → 422', async () => {
    const corpo = execucaoValida();
    corpo.capturas.push({ ...corpo.capturas[0]! });
    expect((await post(corpo)).status).toBe(422);
  });

  it('campo desconhecido → 422 (schema estrito)', async () => {
    expect((await post(execucaoValida({ lancarDireto: true }))).status).toBe(422);
  });

  it('corpo que não é JSON → 400', async () => {
    expect((await post('{nao-json')).status).toBe(400);
  });

  it("'sem_escrituracao' sem valor é aceito", async () => {
    mockRegistrar.mockResolvedValue({ execucaoId: 'e2', competencia: '2026-08', totais: {}, comAlerta: 0 });
    const corpo = execucaoValida();
    Object.assign(corpo.capturas[0]!, { status: 'sem_escrituracao', valorServicosPrestados: null });
    expect((await post(corpo)).status).toBe(201);
  });

  it('token inválido → 401 sem gravar', async () => {
    mockRequireToken.mockImplementation(() => {
      throw new ApiError(401, 'x', 'UNAUTHORIZED');
    });
    expect((await post(execucaoValida())).status).toBe(401);
    expect(mockRegistrar).not.toHaveBeenCalled();
  });
});
