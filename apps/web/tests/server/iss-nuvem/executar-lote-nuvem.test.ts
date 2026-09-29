import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlvoIss, SolicitacaoIss } from '@cobranca/shared';
import { ErroLogin } from '@cobranca/agente-iss/src/portal/portal';
import {
  executarLoteNuvemIss,
  ORCAMENTO_LOTE_MS,
  type DependenciasLoteNuvem,
} from '@/server/iss-nuvem/executar-lote-nuvem';
import { loteNuvemDisponivel, MAQUINA_NUVEM_LIVRE } from '@/server/repositories/iss-solicitacao-repository';

const alvo = (n: number): AlvoIss => ({
  clienteContabilidadeId: `00000000-0000-0000-0000-00000000000${n}`,
  nome: `Empresa ${n}`,
  documento: `1111111100010${n}`,
});

function solicitacao(extra: Partial<SolicitacaoIss> = {}): SolicitacaoIss {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000000',
    competencia: '2026-08',
    documentos: null,
    status: 'em_andamento',
    solicitadoPor: 'u1',
    solicitadoEm: '2026-09-29T10:00:00.000Z',
    iniciadoEm: '2026-09-29T10:00:01.000Z',
    finalizadoEm: null,
    progressoAtual: null,
    progressoTotal: null,
    execucaoId: null,
    mensagemErro: null,
    maquina: 'nuvem:x',
    heartbeatEm: '2026-09-29T10:00:01.000Z',
    ...extra,
  };
}

function montar(opcoes: { s?: SolicitacaoIss | null; alvos?: AlvoIss[]; lidos?: string[]; loginFalha?: Error; msPorEmpresa?: number } = {}) {
  let relogio = Date.parse('2026-09-29T10:00:00.000Z');
  const portal = {
    login: vi.fn(async () => {
      if (opcoes.loginFalha) throw opcoes.loginFalha;
    }),
    sessaoPerdida: vi.fn(() => false),
    recuperar: vi.fn(async () => undefined),
    selecionarEmpresa: vi.fn(async () => ({ inscricao: '1', razaoSocial: 'X' })),
    lerCompetencia: vi.fn(async () => {
      relogio += opcoes.msPorEmpresa ?? 20_000;
      return { tipo: 'capturado' as const, valor: 1000, quantidade: 2, situacao: 'Fechada', fechada: true };
    }),
  };
  const deps: Partial<DependenciasLoteNuvem> = {
    abrirNavegador: vi.fn(async () => ({ portal, fechar: vi.fn(async () => undefined) })),
    reivindicar: vi.fn(async () => (opcoes.s === undefined ? solicitacao() : opcoes.s)),
    renovar: vi.fn(async () => true),
    concluir: vi.fn(async () => solicitacao({ status: 'concluida' })),
    listarAlvos: vi.fn(async () => ({ competencia: '2026-08', alvos: opcoes.alvos ?? [alvo(1), alvo(2)], semDocumento: [] })),
    lidosNaExecucao: vi.fn(async () => new Set(opcoes.lidos ?? [])),
    anexar: vi.fn(async () => 'exec-1'),
    dispararProximo: vi.fn(async () => undefined),
    agora: () => new Date(relogio),
    log: () => undefined,
    intervaloHeartbeatMs: 1_000_000,
  };
  return { deps, portal };
}

beforeEach(() => {
  process.env.ISS_CPF = '12345678901';
  process.env.ISS_SENHA = 'segredo-ok';
});
afterEach(() => {
  delete process.env.ISS_CPF;
  delete process.env.ISS_SENHA;
});

describe('executarLoteNuvemIss', () => {
  it('sem solicitação disponível não abre o navegador', async () => {
    const { deps } = montar({ s: null });
    expect(await executarLoteNuvemIss(deps)).toBe('sem_trabalho');
    expect(deps.abrirNavegador).not.toHaveBeenCalled();
  });

  it('sem ISS_CPF/ISS_SENHA não reivindica nada', async () => {
    delete process.env.ISS_SENHA;
    const { deps } = montar();
    expect(await executarLoteNuvemIss(deps)).toBe('sem_trabalho');
    expect(deps.reivindicar).not.toHaveBeenCalled();
  });

  it('lê tudo num lote só, grava e conclui com a execução', async () => {
    const { deps, portal } = montar();
    expect(await executarLoteNuvemIss(deps)).toBe('concluida');
    expect(portal.login).toHaveBeenCalledTimes(1);
    expect(deps.anexar).toHaveBeenCalledWith(expect.objectContaining({ execucaoId: null, capturas: expect.any(Array) }));
    expect(vi.mocked(deps.anexar!).mock.calls[0]![0].capturas).toHaveLength(2);
    expect(deps.concluir).toHaveBeenCalledWith(expect.any(String), { execucaoId: 'exec-1' }, expect.any(Date));
    expect(deps.dispararProximo).not.toHaveBeenCalled();
  });

  it('estourou o orçamento: grava o parcial, libera o lote e dispara o próximo', async () => {
    const alvos = [alvo(1), alvo(2), alvo(3), alvo(4)];
    const { deps } = montar({ alvos, msPorEmpresa: ORCAMENTO_LOTE_MS / 2 + 1 });
    expect(await executarLoteNuvemIss(deps)).toBe('lote_ok');
    expect(vi.mocked(deps.anexar!).mock.calls[0]![0].capturas).toHaveLength(2);
    expect(deps.renovar).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), { execucaoId: 'exec-1', liberar: true }, expect.any(Date));
    expect(deps.dispararProximo).toHaveBeenCalledTimes(1);
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('lote seguinte pula quem já foi lido na execução da solicitação', async () => {
    const { deps, portal } = montar({
      s: solicitacao({ execucaoId: 'exec-1', maquina: MAQUINA_NUVEM_LIVRE }),
      lidos: [alvo(1).clienteContabilidadeId],
    });
    expect(await executarLoteNuvemIss(deps)).toBe('concluida');
    expect(portal.selecionarEmpresa).toHaveBeenCalledTimes(1);
    expect(portal.selecionarEmpresa).toHaveBeenCalledWith(alvo(2).documento);
    expect(vi.mocked(deps.anexar!).mock.calls[0]![0].execucaoId).toBe('exec-1');
  });

  it('senha recusada encerra como falhou, sem tentar de novo e sem vazar a senha', async () => {
    const { deps, portal } = montar({ loginFalha: new ErroLogin('Login recusado (senha segredo-ok)') });
    expect(await executarLoteNuvemIss(deps)).toBe('falhou');
    expect(portal.login).toHaveBeenCalledTimes(1);
    const erro = (vi.mocked(deps.concluir!).mock.calls[0]![1] as { erro: string }).erro;
    expect(erro).toContain('não tenta de novo');
    expect(erro).not.toContain('segredo-ok');
    expect(deps.anexar).not.toHaveBeenCalled();
  });

  it('solicitação cancelada no meio: para sem gravar', async () => {
    const { deps } = montar();
    vi.mocked(deps.renovar!).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await executarLoteNuvemIss(deps)).toBe('cancelada');
    expect(deps.anexar).not.toHaveBeenCalled();
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('"Tentar de novo" de uma empresa lê só ela', async () => {
    const { deps, portal } = montar({ s: solicitacao({ documentos: [alvo(2).documento] }) });
    expect(await executarLoteNuvemIss(deps)).toBe('concluida');
    expect(portal.selecionarEmpresa).toHaveBeenCalledTimes(1);
    expect(portal.selecionarEmpresa).toHaveBeenCalledWith(alvo(2).documento);
  });

  it('nenhuma empresa para buscar: falha sem abrir o portal', async () => {
    const { deps } = montar({ alvos: [] });
    expect(await executarLoteNuvemIss(deps)).toBe('falhou');
    expect(deps.abrirNavegador).not.toHaveBeenCalled();
  });
});

describe('loteNuvemDisponivel', () => {
  const agora = new Date('2026-09-29T10:05:00.000Z');
  it('pendente, lote liberado ou lease vencido: disponível', () => {
    expect(loteNuvemDisponivel(solicitacao({ status: 'pendente' }), agora)).toBe(true);
    expect(loteNuvemDisponivel(solicitacao({ maquina: MAQUINA_NUVEM_LIVRE, heartbeatEm: agora.toISOString() }), agora)).toBe(true);
    expect(loteNuvemDisponivel(solicitacao({ heartbeatEm: '2026-09-29T10:03:00.000Z' }), agora)).toBe(true);
  });
  it('lote com sinal de vida recente ou solicitação terminada: indisponível', () => {
    expect(loteNuvemDisponivel(solicitacao({ heartbeatEm: '2026-09-29T10:04:30.000Z' }), agora)).toBe(false);
    expect(loteNuvemDisponivel(solicitacao({ status: 'concluida' }), agora)).toBe(false);
  });
});
