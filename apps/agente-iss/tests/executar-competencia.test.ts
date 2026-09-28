// Miolo extraído do CLI (Story 13.5, AC 14, 18): `executarCompetencia` com o portal, o navegador,
// os alvos e o relógio trocados por dublês — nada de Playwright, rede ou portal real. Pasta
// temporária real para o JSON parcial.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { AlvosIssResposta } from '@cobranca/shared';
import {
  executarCompetencia,
  VERSAO_AGENTE,
  type DependenciasExecucao,
  type PortalParaExecucao,
} from '../src/executar-competencia';
import { ErroComunicadoPendente, ErroEmpresaNaoEncontrada, ErroLogin, type LeituraCompetencia } from '../src/portal/portal';
import type { ConfigAgente } from '../src/config';

const CPF = '12345678901';
let base: string;
let cfg: ConfigAgente;

const alvos: AlvosIssResposta = {
  competencia: '2026-08',
  alvos: [
    { clienteContabilidadeId: 'c1', nome: 'AQG SERVICOS', documento: '11111111000111' },
    { clienteContabilidadeId: 'c2', nome: 'BERCI SERVICOS', documento: '22222222000122' },
    { clienteContabilidadeId: 'c3', nome: 'CARMEM LTDA', documento: '33333333000133' },
  ],
  semDocumento: [{ clienteContabilidadeId: 'c9', nome: 'SEM DOC' }],
};

/** Portal de mentira: cada documento responde o que o teste mandar. */
function portalFake(respostas: Record<string, LeituraCompetencia | Error>) {
  const chamadas = { login: 0, recuperar: 0, selecionadas: [] as string[] };
  let perdida = false;
  const portal: PortalParaExecucao & { perder(): void } = {
    async login() {
      chamadas.login += 1;
    },
    sessaoPerdida: () => perdida,
    async recuperar() {
      chamadas.recuperar += 1;
      perdida = false;
    },
    async selecionarEmpresa(documento) {
      chamadas.selecionadas.push(documento);
      const r = respostas[documento];
      if (r instanceof ErroEmpresaNaoEncontrada) throw r;
      return { inscricao: `IM-${documento.slice(0, 3)}`, razaoSocial: `RAZAO ${documento.slice(0, 3)}` };
    },
    async lerCompetencia() {
      const doc = chamadas.selecionadas[chamadas.selecionadas.length - 1]!;
      const r = respostas[doc] ?? { tipo: 'sem_escrituracao' };
      if (r instanceof Error) throw r;
      return r;
    },
    perder() {
      perdida = true;
    },
  };
  return { portal, chamadas };
}

function deps(portal: PortalParaExecucao, over: Partial<DependenciasExecucao> = {}) {
  const fechar = vi.fn(async () => undefined);
  const logs: string[] = [];
  const d: Partial<DependenciasExecucao> = {
    abrirNavegador: vi.fn(async () => ({ page: {} as Page, fechar })),
    criarPortal: vi.fn(() => portal),
    buscarAlvos: vi.fn(async () => alvos),
    criarDiagnostico: () => ({ reconhecer: false, log: (m: string) => logs.push(m), snapshot: vi.fn(async () => null) }),
    esperar: vi.fn(async () => undefined),
    agora: () => new Date('2026-09-28T13:00:00.000Z'),
    maquina: () => 'ESCRITORIO-01',
    aoInterromper: vi.fn(() => () => undefined),
    ...over,
  };
  return { d, fechar, logs };
}

const capturado = (valor: number): LeituraCompetencia => ({
  tipo: 'capturado',
  valor,
  quantidade: 2,
  situacao: 'Fechada - Normal',
  fechada: true,
});

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agente-iss-executar-'));
  cfg = { pastaBase: base, issCpf: CPF, issSenha: 'segredo', token: 't'.repeat(64), sistemaUrl: 'https://sistema.exemplo' };
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('executarCompetencia', () => {
  it('lê todas as empresas e devolve o NovaExecucaoIss no formato de montarExecucao', async () => {
    const { portal, chamadas } = portalFake({
      '11111111000111': capturado(23202.42),
      '22222222000122': { tipo: 'sem_escrituracao' },
      '33333333000133': new ErroEmpresaNaoEncontrada('não está no perfil'),
    });
    const { d, fechar } = deps(portal);

    const r = await executarCompetencia({ competencia: '2026-08', documentos: [], config: cfg, dependencias: d });

    expect(d.buscarAlvos).toHaveBeenCalledWith('https://sistema.exemplo', 't'.repeat(64), '2026-08');
    expect(chamadas.login).toBe(1);
    expect(r.execucao).toMatchObject({
      competencia: '2026-08',
      maquina: 'ESCRITORIO-01',
      versaoAgente: VERSAO_AGENTE,
      ciencias: [],
    });
    expect(r.execucao!.capturas.map((c) => [c.clienteContabilidadeId, c.status])).toEqual([
      ['c1', 'capturado'],
      ['c2', 'sem_escrituracao'],
      ['c3', 'nao_encontrado'],
    ]);
    expect(r.execucao!.capturas[0]).toMatchObject({ valorServicosPrestados: 23202.42, inscricaoMunicipal: 'IM-111' });
    expect(fechar).toHaveBeenCalledTimes(1);
    // O JSON salvo é o mesmo que foi devolvido (é ele que o reenvio automático lê depois).
    expect(JSON.parse(readFileSync(r.arquivoJson, 'utf8'))).toEqual(r.execucao);
    expect(r.avisos.join(' ')).toMatch(/1 cliente\(s\) sem CPF\/CNPJ/);
  });

  it('onProgresso: 0/total antes do portal e N/total a cada empresa', async () => {
    const { portal } = portalFake({});
    const { d } = deps(portal);
    const progresso: string[] = [];
    await executarCompetencia({
      competencia: '2026-08',
      documentos: [],
      config: cfg,
      dependencias: d,
      onProgresso: ({ atual, total }) => {
        progresso.push(`${atual}/${total}`);
      },
    });
    expect(progresso).toEqual(['0/3', '1/3', '2/3', '3/3']);
  });

  it('documentos filtram os alvos (mesmo filtro do --cnpj) e avisam os que não são da carteira', async () => {
    const { portal, chamadas } = portalFake({});
    const { d } = deps(portal);
    const r = await executarCompetencia({
      competencia: '2026-08',
      documentos: ['22222222000122', '99999999000199'],
      config: cfg,
      dependencias: d,
    });
    expect(chamadas.selecionadas).toEqual(['22222222000122']);
    expect(r.execucao!.capturas).toHaveLength(1);
    expect(r.avisos.join(' ')).toMatch(/99999999000199/);
  });

  it('nenhum alvo ⇒ execucao null, sem abrir o navegador', async () => {
    const { portal } = portalFake({});
    const { d } = deps(portal);
    const r = await executarCompetencia({ competencia: '2026-08', documentos: ['99999999000199'], config: cfg, dependencias: d });
    expect(r).toMatchObject({ execucao: null, motivoSemExecucao: 'sem_alvos' });
    expect(d.abrirNavegador).not.toHaveBeenCalled();
  });

  it('confirmarInicio = false (assistente) ⇒ não abre o portal', async () => {
    const { portal } = portalFake({});
    const { d } = deps(portal);
    const confirmar = vi.fn(async () => false);
    const r = await executarCompetencia({ competencia: '2026-08', documentos: [], config: cfg, dependencias: d, confirmarInicio: confirmar });
    expect(confirmar).toHaveBeenCalledWith(3);
    expect(r.motivoSemExecucao).toBe('nao_confirmado');
    expect(d.abrirNavegador).not.toHaveBeenCalled();
  });

  it('senha recusada (ErroLogin) propaga e fecha o navegador', async () => {
    const { portal } = portalFake({});
    portal.login = async () => {
      throw new ErroLogin('Login recusado pelo portal');
    };
    const { d, fechar } = deps(portal);
    await expect(executarCompetencia({ competencia: '2026-08', documentos: [], config: cfg, dependencias: d })).rejects.toBeInstanceOf(
      ErroLogin,
    );
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it('erro numa empresa vira captura "erro" (com CPF redigido) e as outras seguem', async () => {
    const { portal, chamadas } = portalFake({
      '11111111000111': new Error(`tela inesperada para ${CPF}`),
      '22222222000122': new ErroComunicadoPendente('comunicado pendente'),
      '33333333000133': capturado(10),
    });
    const { d } = deps(portal);
    const r = await executarCompetencia({ competencia: '2026-08', documentos: [], config: cfg, dependencias: d });
    const [c1, c2, c3] = r.execucao!.capturas;
    expect(c1).toMatchObject({ status: 'erro', mensagemErro: 'tela inesperada para [CPF]' });
    expect(c2).toMatchObject({ status: 'erro', mensagemErro: 'comunicado pendente' });
    expect(c3!.status).toBe('capturado');
    expect(chamadas.recuperar).toBe(2);
  });

  it('sessão que cai no meio: reloga e tenta a MESMA empresa de novo', async () => {
    const { portal, chamadas } = portalFake({ '11111111000111': capturado(5) });
    let primeira = true;
    const lerOriginal = portal.lerCompetencia.bind(portal);
    portal.lerCompetencia = async (c) => {
      if (primeira) {
        primeira = false;
        portal.perder();
        throw new Error('página de login');
      }
      return lerOriginal(c);
    };
    const { d } = deps(portal);
    const r = await executarCompetencia({ competencia: '2026-08', documentos: ['11111111000111'], config: cfg, dependencias: d });
    expect(r.execucao!.capturas[0]!.status).toBe('capturado');
    expect(chamadas.recuperar).toBe(1);
    expect(chamadas.selecionadas).toEqual(['11111111000111', '11111111000111']);
  });

  it('onProgresso que LANÇA interrompe a rodada, fecha o navegador e deixa o parcial salvo', async () => {
    const { portal, chamadas } = portalFake({});
    const { d, fechar } = deps(portal);
    let pastaJson = '';
    await expect(
      executarCompetencia({
        competencia: '2026-08',
        documentos: [],
        config: cfg,
        dependencias: {
          ...d,
          criarDiagnostico: (pasta) => {
            pastaJson = join(pasta, 'execucao.json');
            return { reconhecer: false, log: () => undefined, snapshot: async () => null };
          },
        },
        onProgresso: ({ atual }) => {
          if (atual === 1) throw new Error('cancelada');
        },
      }),
    ).rejects.toThrow('cancelada');
    expect(chamadas.selecionadas).toHaveLength(1);
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(existsSync(pastaJson)).toBe(true);
    expect(JSON.parse(readFileSync(pastaJson, 'utf8')).capturas).toHaveLength(1);
  });

  it('cada chamada abre o SEU navegador e faz o SEU login (AC 18)', async () => {
    const { portal, chamadas } = portalFake({});
    const { d, fechar } = deps(portal);
    await executarCompetencia({ competencia: '2026-08', documentos: [], config: cfg, dependencias: d });
    await executarCompetencia({ competencia: '2026-07', documentos: [], config: cfg, dependencias: d });
    expect(d.abrirNavegador).toHaveBeenCalledTimes(2);
    expect(chamadas.login).toBe(2);
    expect(fechar).toHaveBeenCalledTimes(2);
  });

  it('--offline: alvos vêm dos documentos, sem falar com o sistema', async () => {
    const { portal } = portalFake({ '11111111000111': capturado(1) });
    const { d } = deps(portal);
    const r = await executarCompetencia({
      competencia: '2026-08',
      documentos: ['11111111000111'],
      offline: true,
      config: cfg,
      dependencias: d,
    });
    expect(d.buscarAlvos).not.toHaveBeenCalled();
    expect(r.execucao!.capturas[0]!.clienteContabilidadeId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('--limite corta os alvos; o registro do Ctrl+C é desfeito no fim', async () => {
    const { portal, chamadas } = portalFake({});
    const desfazer = vi.fn();
    const { d } = deps(portal, { aoInterromper: vi.fn(() => desfazer) });
    await executarCompetencia({ competencia: '2026-08', documentos: [], limite: 2, config: cfg, dependencias: d });
    expect(chamadas.selecionadas).toHaveLength(2);
    expect(desfazer).toHaveBeenCalledTimes(1);
  });
});
