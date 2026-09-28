// Cliente das rotas de solicitação (Story 13.5, AC 10–12) — `fetch` trocado por dublê: nada de rede.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buscarProximaSolicitacao,
  concluirSolicitacao,
  enviarProgresso,
  ErroApi,
} from '../src/api-client';

const URL_SISTEMA = 'https://sistema.exemplo';
const TOKEN = 't'.repeat(64);
const fetchFalso = vi.fn();

beforeEach(() => {
  fetchFalso.mockReset();
  vi.stubGlobal('fetch', fetchFalso);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buscarProximaSolicitacao', () => {
  it('204 ⇒ null; manda o token e o nome da máquina', async () => {
    fetchFalso.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await buscarProximaSolicitacao(URL_SISTEMA, TOKEN, 'ESCRITÓRIO 01')).toBeNull();
    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toBe(`${URL_SISTEMA}/api/integracoes/iss/solicitacoes/proxima?maquina=ESCRIT%C3%93RIO%2001`);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('200 ⇒ a solicitação', async () => {
    fetchFalso.mockResolvedValue(Response.json({ id: 'sol-1', competencia: '2026-08' }));
    expect(await buscarProximaSolicitacao(URL_SISTEMA, TOKEN, 'X')).toMatchObject({ id: 'sol-1' });
  });

  it('401 ⇒ ErroApi com a dica do token', async () => {
    fetchFalso.mockResolvedValue(Response.json({ error: { message: 'Token inválido' } }, { status: 401 }));
    await expect(buscarProximaSolicitacao(URL_SISTEMA, TOKEN, 'X')).rejects.toMatchObject({
      status: 401,
      message: expect.stringMatching(/AGENTE_ISS_TOKEN/),
    });
  });
});

describe('enviarProgresso / concluirSolicitacao', () => {
  it('POST com o corpo certo', async () => {
    fetchFalso.mockImplementation(async () => Response.json({ id: 'sol-1' }));
    await enviarProgresso(URL_SISTEMA, TOKEN, 'sol-1', 34, 90);
    await concluirSolicitacao(URL_SISTEMA, TOKEN, 'sol-1', { execucaoId: 'exec-1' });
    await concluirSolicitacao(URL_SISTEMA, TOKEN, 'sol-1', { erro: 'senha' });
    const chamadas = fetchFalso.mock.calls.map(([url, init]) => [url, (init as RequestInit).method, (init as RequestInit).body]);
    expect(chamadas).toEqual([
      [`${URL_SISTEMA}/api/integracoes/iss/solicitacoes/sol-1/progresso`, 'POST', '{"atual":34,"total":90}'],
      [`${URL_SISTEMA}/api/integracoes/iss/solicitacoes/sol-1/concluir`, 'POST', '{"execucaoId":"exec-1"}'],
      [`${URL_SISTEMA}/api/integracoes/iss/solicitacoes/sol-1/concluir`, 'POST', '{"erro":"senha"}'],
    ]);
  });

  it('409 (cancelada) chega como ErroApi status 409 — é o que faz o vigiar parar', async () => {
    fetchFalso.mockResolvedValue(Response.json({ error: { message: 'não está em andamento' } }, { status: 409 }));
    const erro = await enviarProgresso(URL_SISTEMA, TOKEN, 'sol-1', 1, 2).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro.status).toBe(409);
  });
});
