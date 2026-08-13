// Testes do Fin API Client (Épico 5, story 5.1) — mock de fetch, sem rede real.
// Cobre: normalização defensiva, os 3 endpoints, 401/4xx sem retry, 5xx/rede com retry,
// esgotamento → FIN_API_RETRY, corpo não-array → FIN_API_FORMATO, CONFIG ausente e modo local.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '../../../src/lib/api-error';

// getServerEnv() lê process.env em tempo de chamada, então setamos por teste.
function ligarModoHttp() {
  process.env.FIN_API_SOURCE = 'http';
  process.env.API_FINANCEIRO_URL = 'https://sistema-web.example.com';
  process.env.API_FINANCEIRO_KEY = 'chave-de-teste-segura-20-caracteres';
}

function resetEnv() {
  process.env.FIN_API_SOURCE = 'local';
  delete process.env.API_FINANCEIRO_URL;
  delete process.env.API_FINANCEIRO_KEY;
}

// Import dinâmico após configurar o ambiente (padrão do teste do client anterior).
async function client() {
  return import('../../../src/server/integration/fin-api-client');
}

const clienteBruto = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Dr. João Silva',
  cpf: '12345678900',
  production_type: 'Produção Credenciada',
};

const producaoBruta = {
  id: '661e9511-f30c-52e5-b827-557766551111',
  name: 'Janeiro 2026',
};

const loteBruto = {
  id: 'lote-991',
  name: 'SAMANTA CETETER 1Q',
};

const itemBruto = {
  date: '2026-01-15',
  patient_name: 'Ana Paula Ferreira',
  password: 'AB123456',
  proc_code: '30721033',
  proc_name: 'Consulta em consultório',
  status: 'Devidamente Pago',
  via_acesso: 'Sim',
  act_type: 'Eletivo',
  charged_val: 150.5,
  paid_val: 130.0,
};

beforeEach(() => {
  ligarModoHttp();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetEnv();
  vi.restoreAllMocks();
});

describe('normalização defensiva — contrato real → tipos do domínio', () => {
  it('toItemProducao mapeia todos os campos do contrato', async () => {
    const { toItemProducao } = await client();
    expect(toItemProducao(itemBruto)).toEqual({
      data: '2026-01-15',
      pacienteNome: 'Ana Paula Ferreira',
      atendimentoExternoId: 'AB123456',
      codigoProcedimento: '30721033',
      descricaoProcedimento: 'Consulta em consultório',
      statusOrigem: 'Devidamente Pago',
      viaAcesso: true,
      tipoAto: 'Eletivo',
      valorCobradoOrigem: 150.5,
      valorPagoOrigem: 130.0,
    });
  });

  it('via_acesso: só a string "Sim" vira true (null/"Não"/ausente → false)', async () => {
    const { toItemProducao } = await client();
    expect(toItemProducao({ ...itemBruto, via_acesso: null }).viaAcesso).toBe(false);
    expect(toItemProducao({ ...itemBruto, via_acesso: 'Não' }).viaAcesso).toBe(false);
    const semCampo = { ...itemBruto } as Record<string, unknown>;
    delete semCampo.via_acesso;
    expect(toItemProducao(semCampo).viaAcesso).toBe(false);
  });

  it('data longa (timestamp ISO) é cortada em YYYY-MM-DD; números inválidos viram null', async () => {
    const { toItemProducao } = await client();
    const p = toItemProducao({
      ...itemBruto,
      date: '2026-01-15T10:30:00Z',
      charged_val: 'abc',
      paid_val: null,
    });
    expect(p.data).toBe('2026-01-15');
    expect(p.valorCobradoOrigem).toBeNull();
    expect(p.valorPagoOrigem).toBeNull();
  });

  it('atendimentoExternoId: usa password (contrato real); aceita senha/numero_atendimento como fallback', async () => {
    const { toItemProducao } = await client();
    const semPassword = { ...itemBruto } as Record<string, unknown>;
    delete semPassword.password;
    expect(toItemProducao({ ...semPassword, senha: 'S-123' }).atendimentoExternoId).toBe('S-123');
    expect(
      toItemProducao({ ...semPassword, numero_atendimento: 'AT-9' }).atendimentoExternoId,
    ).toBe('AT-9');
    expect(toItemProducao({ ...semPassword, senha: '  ' }).atendimentoExternoId).toBeNull();
    expect(toItemProducao({ ...itemBruto, password: '  ' }).atendimentoExternoId).toBeNull();
  });

  it('statusOrigem transporta cru — Glosado/Recurso NÃO são filtrados aqui (decisão 5)', async () => {
    const { toItemProducao } = await client();
    expect(toItemProducao({ ...itemBruto, status: 'Glosado' }).statusOrigem).toBe('Glosado');
    expect(toItemProducao({ ...itemBruto, status: 'Recurso' }).statusOrigem).toBe('Recurso');
  });

  it('toClienteExterno e toProducaoExterna mapeiam os campos do contrato', async () => {
    const { toClienteExterno, toProducaoExterna } = await client();
    expect(toClienteExterno(clienteBruto)).toEqual({
      id: '550e8400-e29b-41d4-a716-446655440000',
      nome: 'Dr. João Silva',
      cpf: '12345678900',
      productionType: 'Produção Credenciada',
    });
    expect(toProducaoExterna(producaoBruta)).toEqual({
      id: '661e9511-f30c-52e5-b827-557766551111',
      nome: 'Janeiro 2026',
    });
  });

  it('toLoteExterna mapeia id e name do sub-lote', async () => {
    const { toLoteExterna } = await client();
    expect(toLoteExterna(loteBruto)).toEqual({ id: 'lote-991', nome: 'SAMANTA CETETER 1Q' });
  });

  it('cpf: normaliza mesmo quando a origem entrega formatado (ex.: "010.508.863-30")', async () => {
    const { toClienteExterno } = await client();
    expect(toClienteExterno({ ...clienteBruto, cpf: '010.508.863-30' }).cpf).toBe('01050886330');
    expect(toClienteExterno({ ...clienteBruto, cpf: null }).cpf).toBeNull();
    expect(toClienteExterno({ ...clienteBruto, cpf: '' }).cpf).toBeNull();
  });
});

describe('endpoints http — URLs, header e parâmetros do contrato', () => {
  it('listarClientes: GET /api/fin-clientes com x-api-key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([clienteBruto]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { listarClientes } = await client();
    const r = await listarClientes();
    expect(r).toHaveLength(1);
    expect(r[0]?.nome).toBe('Dr. João Silva');

    const [urlArg, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(urlArg.toString()).toContain('/api/fin-clientes');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('chave-de-teste-segura-20-caracteres');
  });

  it('listarProducoes: envia clienteId na query', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([producaoBruta]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { listarProducoes } = await client();
    const r = await listarProducoes('cliente-1');
    expect(r[0]?.nome).toBe('Janeiro 2026');

    const [urlArg] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(urlArg.toString()).toContain('/api/fin-producoes');
    expect(urlArg.searchParams.get('clienteId')).toBe('cliente-1');
  });

  it('buscarItens: envia producaoId na query; array vazio é caminho válido', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { buscarItens } = await client();
    const r = await buscarItens('producao-1');
    expect(r).toEqual([]);

    const [urlArg] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(urlArg.toString()).toContain('/api/fin-itens');
    expect(urlArg.searchParams.get('producaoId')).toBe('producao-1');
  });

  it('listarLotes: GET /api/fin-lotes com producaoId (sub-lotes do Angiologista)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([loteBruto]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { listarLotes } = await client();
    const r = await listarLotes('producao-mensal-1');
    expect(r[0]?.nome).toBe('SAMANTA CETETER 1Q');

    const [urlArg] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(urlArg.toString()).toContain('/api/fin-lotes');
    expect(urlArg.searchParams.get('producaoId')).toBe('producao-mensal-1');
  });

  it('buscarItensPorLote: envia loteId (não producaoId) na query', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([itemBruto]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { buscarItensPorLote } = await client();
    const r = await buscarItensPorLote('lote-991');
    expect(r).toHaveLength(1);

    const [urlArg] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(urlArg.toString()).toContain('/api/fin-itens');
    expect(urlArg.searchParams.get('loteId')).toBe('lote-991');
    expect(urlArg.searchParams.get('producaoId')).toBeNull();
  });

  it('preserva path-base já presente em API_FINANCEIRO_URL', async () => {
    process.env.API_FINANCEIRO_URL = 'https://sistema-web.example.com/base/';
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { listarClientes } = await client();
    await listarClientes();
    const [urlArg] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(urlArg.toString()).toBe('https://sistema-web.example.com/base/api/fin-clientes');
  });
});

describe('endpoints http — erros e resiliência', () => {
  it('401: chave inválida → ApiError FIN_API_401, sem retry', async () => {
    const fetchMock = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { buscarItens } = await client();
    await expect(buscarItens('p1')).rejects.toMatchObject({ code: 'FIN_API_401' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('4xx não-401/429 → ApiError FIN_API_CLIENT, sem retry', async () => {
    const fetchMock = vi.fn(async () => new Response('bad', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const { listarProducoes } = await client();
    await expect(listarProducoes('c1')).rejects.toMatchObject({ code: 'FIN_API_CLIENT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 (rate limit) é transitório: aciona retry e tem sucesso na 2ª tentativa', async () => {
    let chamada = 0;
    const fetchMock = vi.fn(async () => {
      chamada += 1;
      if (chamada === 1) return new Response('rate limited', { status: 429 });
      return new Response(JSON.stringify([itemBruto]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { buscarItens } = await client();
    const r = await buscarItens('p1');
    expect(r).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('corpo não-array → ApiError FIN_API_FORMATO, sem retry', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { listarClientes } = await client();
    await expect(listarClientes()).rejects.toMatchObject({ code: 'FIN_API_FORMATO' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('erro de rede transitório aciona retry e tem sucesso na 2ª tentativa', async () => {
    let chamada = 0;
    const fetchMock = vi.fn(async () => {
      chamada += 1;
      if (chamada === 1) throw new Error('network down');
      return new Response(JSON.stringify([itemBruto]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { buscarItens } = await client();
    const r = await buscarItens('p1');
    expect(r).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('5xx é transitório: esgota 3 tentativas → ApiError FIN_API_RETRY', async () => {
    const fetchMock = vi.fn(async () => new Response('err', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { buscarItens } = await client();
    await expect(buscarItens('p1')).rejects.toMatchObject({ code: 'FIN_API_RETRY' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('CONFIG: modo http sem env vars → ApiError CONFIG', async () => {
    delete process.env.API_FINANCEIRO_URL;
    delete process.env.API_FINANCEIRO_KEY;
    vi.stubGlobal('fetch', vi.fn());
    const { listarClientes } = await client();
    const erro = await listarClientes().catch((e) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.code).toBe('CONFIG');
  });
});

describe('modo local (FIN_API_SOURCE=local) — fixtures', () => {
  it('serve clientes/produções/itens registrados; vazio por padrão', async () => {
    resetEnv(); // FIN_API_SOURCE=local
    const { listarClientes, listarProducoes, buscarItens, toItemProducao } = await client();
    const fixtures = await import('../../../src/server/integration/fixtures-local');

    expect(await listarClientes()).toEqual([]);
    expect(await listarProducoes('c1')).toEqual([]);
    expect(await buscarItens('p1')).toEqual([]);

    fixtures.registrarFixtureClientes([
      { id: 'c1', nome: 'Dra. Maria Souza', cpf: null, productionType: 'Produção VH' },
    ]);
    fixtures.registrarFixtureProducoes('c1', [{ id: 'p1', nome: 'Fevereiro 2026' }]);
    fixtures.registrarFixtureItens('p1', [toItemProducao(itemBruto)]);

    expect((await listarClientes())[0]?.nome).toBe('Dra. Maria Souza');
    expect((await listarProducoes('c1'))[0]?.nome).toBe('Fevereiro 2026');
    expect((await buscarItens('p1'))[0]?.pacienteNome).toBe('Ana Paula Ferreira');
  });

  it('serve lotes/itens-por-lote registrados (sub-lotes do Angiologista); vazio por padrão', async () => {
    resetEnv(); // FIN_API_SOURCE=local
    const { listarLotes, buscarItensPorLote, buscarItens, toItemProducao } = await client();
    const fixtures = await import('../../../src/server/integration/fixtures-local');

    expect(await listarLotes('p1')).toEqual([]);
    expect(await buscarItensPorLote('lote-1')).toEqual([]);

    fixtures.registrarFixtureLotes('p1', [{ id: 'lote-1', nome: 'SAMANTA CETETER 1Q' }]);
    fixtures.registrarFixtureItensPorLote('lote-1', [toItemProducao(itemBruto)]);

    expect((await listarLotes('p1'))[0]?.nome).toBe('SAMANTA CETETER 1Q');
    expect((await buscarItensPorLote('lote-1'))[0]?.pacienteNome).toBe('Ana Paula Ferreira');
    // Namespace separado de produções: um item registrado só por loteId não vaza pra buscarItens.
    expect(await buscarItens('lote-1')).toEqual([]);
  });
});
