// Testes do Integration Client em modo HTTP — mock de fetch (a API real não existe; PRD §11).
// Cobre: resposta normal, array vazio, 401, timeout/erro de rede com retry, e esgotamento
// de tentativas virando ApiError 'CARMEM_RETRY' (que o Orchestrator transforma em alerta).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '../../../src/lib/api-error';

// getServerEnv() lê process.env em tempo de chamada, então setamos por teste.
function ligarModoHttp() {
  process.env.PROCEDIMENTOS_SOURCE = 'http';
  process.env.CARMEM_API_URL = 'https://carmem.example.com';
  process.env.CARMEM_API_KEY = 'chave-de-teste';
}

function resetEnv() {
  process.env.PROCEDIMENTOS_SOURCE = 'local';
  delete process.env.CARMEM_API_URL;
  delete process.env.CARMEM_API_KEY;
}

// Import dinâmico após configurar o ambiente.
async function client() {
  return import('../../../src/server/integration/procedimentos-client');
}

const procedimentoBruto = {
  cpf_medico: '00000000001',
  numero_atendimento: 'AT-1',
  senha_procedimento: 'S1',
  data_emissao: '2026-06-10',
  data_procedimento: '2026-06-10',
  tipo: 'A1',
  descricao_procedimento: 'Artrodese',
  codigo_procedimento: '30602059',
  valor: 123.45,
  local_atendimento: 'Hospital X',
  plano: 'Hapvida',
};

beforeEach(() => {
  ligarModoHttp();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetEnv();
  vi.restoreAllMocks();
});

describe('normalizarProcedimento — parsing 1:1 do contrato PRD §6.4', () => {
  it('mapeia todos os campos snake_case do contrato para o tipo Procedimento', async () => {
    const { normalizarProcedimento } = await client();
    const p = normalizarProcedimento(procedimentoBruto);
    expect(p).toEqual({
      cpfMedico: '00000000001',
      numeroAtendimento: 'AT-1',
      senhaProcedimento: 'S1',
      dataEmissao: '2026-06-10',
      dataProcedimento: '2026-06-10',
      tipo: 'A1',
      descricaoProcedimento: 'Artrodese',
      codigoProcedimento: '30602059',
      valor: 123.45,
      localAtendimento: 'Hospital X',
      plano: 'Hapvida',
    });
  });

  it('campos nulos do contrato viram null; valor não-numérico vira null', async () => {
    const { normalizarProcedimento } = await client();
    const p = normalizarProcedimento({
      ...procedimentoBruto,
      descricao_procedimento: null,
      valor: 'nao-numero',
      tipo: 'X', // papel inválido → 'M'
    });
    expect(p.descricaoProcedimento).toBeNull();
    expect(p.valor).toBeNull();
    expect(p.tipo).toBe('M');
  });
});

describe('buscarProcedimentos (http) — caminhos de resposta', () => {
  it('resposta normal: array de procedimentos parseado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([procedimentoBruto]), { status: 200 })),
    );
    const { buscarProcedimentos } = await client();
    const r = await buscarProcedimentos('00000000001', '2026-06');
    expect(r).toHaveLength(1);
    expect(r[0]?.numeroAtendimento).toBe('AT-1');
  });

  it('array vazio (200): caminho válido, médico sem produção → []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    const { buscarProcedimentos } = await client();
    const r = await buscarProcedimentos('00000000001', '2026-06');
    expect(r).toEqual([]);
  });

  it('envia X-API-Key e os parâmetros competencia/cpf no contrato', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { buscarProcedimentos } = await client();
    await buscarProcedimentos('00000000001', '2026-06');

    const [urlArg, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(urlArg.toString()).toContain('/api/procedimentos');
    expect(urlArg.searchParams.get('competencia')).toBe('2026-06');
    expect(urlArg.searchParams.get('cpf')).toBe('00000000001');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('chave-de-teste');
  });

  it('401: chave inválida/ausente → ApiError CARMEM_401, sem retry', async () => {
    const fetchMock = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { buscarProcedimentos } = await client();
    await expect(buscarProcedimentos('00000000001', '2026-06')).rejects.toMatchObject({
      code: 'CARMEM_401',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // não repete em 401
  });

  it('erro de rede transitório aciona retry e tem sucesso na 2ª tentativa', async () => {
    let chamada = 0;
    const fetchMock = vi.fn(async () => {
      chamada += 1;
      if (chamada === 1) throw new Error('network down');
      return new Response(JSON.stringify([procedimentoBruto]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { buscarProcedimentos } = await client();
    const r = await buscarProcedimentos('00000000001', '2026-06');
    expect(r).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('esgota as 3 tentativas em falha persistente → ApiError CARMEM_RETRY', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { buscarProcedimentos } = await client();
    await expect(buscarProcedimentos('00000000001', '2026-06')).rejects.toMatchObject({
      code: 'CARMEM_RETRY',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('5xx é transitório (retry); 4xx não-401 falha sem retry', async () => {
    const fetch500 = vi.fn(async () => new Response('err', { status: 503 }));
    vi.stubGlobal('fetch', fetch500);
    const { buscarProcedimentos } = await client();
    await expect(buscarProcedimentos('00000000001', '2026-06')).rejects.toMatchObject({
      code: 'CARMEM_RETRY',
    });
    expect(fetch500).toHaveBeenCalledTimes(3); // 503 repetido 3x

    const fetch400 = vi.fn(async () => new Response('bad', { status: 400 }));
    vi.stubGlobal('fetch', fetch400);
    await expect(buscarProcedimentos('00000000001', '2026-06')).rejects.toMatchObject({
      code: 'CARMEM_CLIENT',
    });
    expect(fetch400).toHaveBeenCalledTimes(1); // 400 não repete
  });

  it('CONFIG: modo http sem env vars → ApiError CONFIG', async () => {
    delete process.env.CARMEM_API_URL;
    delete process.env.CARMEM_API_KEY;
    vi.stubGlobal('fetch', vi.fn());
    const { buscarProcedimentos } = await client();
    const erro = await buscarProcedimentos('00000000001', '2026-06').catch((e) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.code).toBe('CONFIG');
  });
});
