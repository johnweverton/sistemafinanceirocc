// Comando `configurar` (Story 13.4, AC 13–14). Pasta temporária real (via AGENTE_ISS_HOME) e
// validação do token com `buscarAlvos`/`fetch` mockados — nada de rede, nada de portal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErroApi } from '../src/api-client';
import { ErroConfig, lerArquivoEnv } from '../src/config';
import { executarConfigurar, gravarConfiguracao, montarEnv, prepararConfiguracao, validarToken } from '../src/configurar';

const TOKEN = 'a'.repeat(64);
const valores = {
  cpf: '123.456.789-01',
  senha: ' s3nh#a "com" espaço ',
  token: TOKEN,
  sistemaUrl: 'https://cobrancacc.vercel.app/',
};
const alvosVazios = { competencia: '2026-09', alvos: [], semDocumento: [] };

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agente-iss-config-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('montarEnv', () => {
  it('gera um .env que lerArquivoEnv lê de volta sem perder nada (senha com #, aspas e espaços)', () => {
    const vars = lerArquivoEnv(montarEnv(valores));
    expect(vars).toEqual({
      ISS_CPF: '12345678901',
      ISS_SENHA: valores.senha,
      AGENTE_ISS_TOKEN: TOKEN,
      SISTEMA_URL: 'https://cobrancacc.vercel.app',
    });
  });
});

describe('prepararConfiguracao / gravarConfiguracao — reusa validarConfig', () => {
  it('recusa pasta dentro do OneDrive e NÃO escreve nada', () => {
    const pasta = join(base, 'OneDrive', 'agente-iss');
    expect(() => gravarConfiguracao(pasta, valores)).toThrow(/OneDrive/);
    expect(existsSync(pasta)).toBe(false);
  });

  it.each([
    [{ cpf: '123' }, /11 dígitos/],
    [{ token: 'curto' }, /mínimo 32/],
    [{ sistemaUrl: 'http://cobranca.com' }, /https/],
    [{ senha: '' }, /ISS_SENHA/],
  ])('dado inválido %j → ErroConfig, sem arquivo', (over, msg) => {
    expect(() => prepararConfiguracao(base, { ...valores, ...over })).toThrow(ErroConfig);
    expect(() => gravarConfiguracao(base, { ...valores, ...over })).toThrow(msg);
    expect(existsSync(join(base, '.env'))).toBe(false);
  });

  it('dados válidos → grava <pastaBase>/.env (criando a pasta)', () => {
    const pasta = join(base, 'nova', 'agente-iss');
    const cfg = gravarConfiguracao(pasta, valores);
    expect(cfg).toMatchObject({ issCpf: '12345678901', sistemaUrl: 'https://cobrancacc.vercel.app' });
    expect(lerArquivoEnv(readFileSync(join(pasta, '.env'), 'utf8')).ISS_SENHA).toBe(valores.senha);
  });
});

describe('validarToken (AC 14)', () => {
  const cfg = { sistemaUrl: 'https://cobrancacc.vercel.app', token: TOKEN };

  it('consulta GET /alvos com a competência do mês atual e confirma "token válido"', async () => {
    const buscar = vi.fn().mockResolvedValue({ ...alvosVazios, alvos: [{ clienteContabilidadeId: 'x', nome: 'A', documento: '1' }] });
    const r = await validarToken(cfg, buscar, new Date(2026, 8, 28));
    expect(buscar).toHaveBeenCalledWith(cfg.sistemaUrl, TOKEN, '2026-09');
    expect(r).toEqual({ ok: true, mensagem: expect.stringMatching(/Token válido.*1 empresa/) });
  });

  it('401 explica que o token não confere com AGENTE_ISS_TOKEN_SHA256 da Vercel', async () => {
    const buscar = vi.fn().mockRejectedValue(new ErroApi('Sistema respondeu 401: não autorizado', 401));
    const r = await validarToken(cfg, buscar);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/Token inválido.*AGENTE_ISS_TOKEN_SHA256.*Vercel/);
  });

  it('sem resposta (URL errada / sem internet) → mensagem sobre a URL', async () => {
    const buscar = vi.fn().mockRejectedValue(new ErroApi('Sem resposta do sistema (fetch failed)', null));
    const r = await validarToken(cfg, buscar);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/Confira a URL do sistema/);
  });

  it('usa o buscarAlvos real por padrão (fetch mockado), com o bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(alvosVazios), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await validarToken(cfg, undefined, new Date(2026, 8, 28));
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://cobrancacc.vercel.app/api/integracoes/iss/alvos?competencia=2026-09');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });
});

describe('executarConfigurar (fluxo com entrada simulada)', () => {
  function simular(respostas: string[], senha: string) {
    const fila = [...respostas];
    const saida: string[] = [];
    return {
      perguntar: vi.fn(async (_texto: string) => fila.shift() ?? ''),
      perguntarSenha: vi.fn(async (_texto: string) => senha),
      escrever: (t: string) => saida.push(t),
      saida,
    };
  }

  it('pergunta CPF, senha (sem eco), token e URL; grava em AGENTE_ISS_HOME e valida o token', async () => {
    const s = simular(['12345678901', TOKEN, 'https://cobrancacc.vercel.app'], 'minhaSenha');
    const buscar = vi.fn().mockResolvedValue(alvosVazios);

    const codigo = await executarConfigurar({ ...s, env: { AGENTE_ISS_HOME: base }, buscar });

    expect(codigo).toBe(0);
    expect(s.perguntarSenha).toHaveBeenCalledTimes(1);
    const vars = lerArquivoEnv(readFileSync(join(base, '.env'), 'utf8'));
    expect(vars).toMatchObject({ ISS_CPF: '12345678901', ISS_SENHA: 'minhaSenha', AGENTE_ISS_TOKEN: TOKEN });
    expect(s.saida.join('\n')).toMatch(/Token válido/);
  });

  it('token recusado (401) → arquivo gravado, mas código 3 e explicação', async () => {
    const s = simular(['12345678901', TOKEN, 'https://cobrancacc.vercel.app'], 'minhaSenha');
    const buscar = vi.fn().mockRejectedValue(new ErroApi('Sistema respondeu 401', 401));

    const codigo = await executarConfigurar({ ...s, env: { AGENTE_ISS_HOME: base }, buscar });

    expect(codigo).toBe(3);
    expect(existsSync(join(base, '.env'))).toBe(true);
    expect(s.saida.join('\n')).toMatch(/AGENTE_ISS_TOKEN_SHA256/);
  });

  it('pasta no OneDrive → nada gravado, código 1, e o sistema nem é consultado', async () => {
    const pasta = join(base, 'OneDrive', 'agente-iss');
    const s = simular(['12345678901', TOKEN, 'https://cobrancacc.vercel.app'], 'minhaSenha');
    const buscar = vi.fn();

    const codigo = await executarConfigurar({ ...s, env: { AGENTE_ISS_HOME: pasta }, buscar });

    expect(codigo).toBe(1);
    expect(existsSync(join(pasta, '.env'))).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
    expect(s.saida.join('\n')).toMatch(/Nada foi gravado/);
  });

  it('com .env existente, Enter mantém os valores atuais (inclusive a senha)', async () => {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, '.env'), montarEnv({ ...valores, senha: 'antiga' }));
    const s = simular(['', '', ''], '');
    const buscar = vi.fn().mockResolvedValue(alvosVazios);

    expect(await executarConfigurar({ ...s, env: { AGENTE_ISS_HOME: base }, buscar })).toBe(0);

    const vars = lerArquivoEnv(readFileSync(join(base, '.env'), 'utf8'));
    expect(vars).toMatchObject({ ISS_CPF: '12345678901', ISS_SENHA: 'antiga', AGENTE_ISS_TOKEN: TOKEN });
    // o token atual aparece mascarado na pergunta, nunca inteiro
    const perguntas = s.perguntar.mock.calls.map((c) => String(c[0])).join('\n');
    expect(perguntas).not.toContain(TOKEN);
  });
});
