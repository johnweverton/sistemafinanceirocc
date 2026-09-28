// Modo vigiar / uma-vez (Story 13.5, AC 15, 16): o laço com a API do sistema e o
// `executarCompetencia` trocados por dublês — nada de rede, portal ou processo real.
import { describe, expect, it, vi } from 'vitest';
import type { ExecucaoIssRegistrada, NovaExecucaoIss, SolicitacaoIss } from '@cobranca/shared';
import { ErroApi } from '../src/api-client';
import { ErroLogin } from '../src/portal/portal';
import type { ResultadoExecucaoCompetencia } from '../src/executar-competencia';
import { INTERVALO_VIGIAR_MS, processarSolicitacao, vigiar, type DependenciasVigiar } from '../src/vigiar';

function solicitacao(over: Partial<SolicitacaoIss> = {}): SolicitacaoIss {
  return {
    id: 'sol-1',
    competencia: '2026-08',
    documentos: null,
    status: 'em_andamento',
    solicitadoPor: 'u1',
    solicitadoEm: '2026-09-28T12:00:00.000Z',
    iniciadoEm: '2026-09-28T12:01:00.000Z',
    finalizadoEm: null,
    progressoAtual: null,
    progressoTotal: null,
    execucaoId: null,
    mensagemErro: null,
    maquina: 'ESCRITORIO-01',
    heartbeatEm: '2026-09-28T12:01:00.000Z',
    ...over,
  };
}

const execucao: NovaExecucaoIss = {
  competencia: '2026-08',
  iniciadoEm: '2026-09-28T12:01:00.000Z',
  finalizadoEm: '2026-09-28T12:05:00.000Z',
  maquina: 'ESCRITORIO-01',
  versaoAgente: '0.1.0',
  capturas: [],
  ciencias: [],
};

const registrada: ExecucaoIssRegistrada = {
  execucaoId: 'exec-9',
  competencia: '2026-08',
  totais: { capturado: 2, nao_encontrado: 0, sem_escrituracao: 1, erro: 0 },
  comAlerta: 0,
};

function resultado(over: Partial<ResultadoExecucaoCompetencia> = {}): ResultadoExecucaoCompetencia {
  return {
    execucao,
    motivoSemExecucao: null,
    resultados: [],
    pastaExecucao: 'C:\\agente-iss\\execucoes\\x',
    arquivoJson: 'C:\\agente-iss\\execucoes\\x\\execucao.json',
    avisos: [],
    ...over,
  };
}

/** Dublês com a "execução" chamando onProgresso para 3 empresas, como o miolo real faz. */
function criarDeps(over: Partial<DependenciasVigiar> = {}) {
  const logs: string[] = [];
  const d: DependenciasVigiar = {
    buscarProxima: vi.fn(async () => null),
    enviarProgresso: vi.fn(async () => undefined),
    enviarExecucao: vi.fn(async () => registrada),
    concluir: vi.fn(async () => undefined),
    executar: vi.fn(async ({ onProgresso }) => {
      for (const atual of [0, 1, 2, 3]) await onProgresso?.({ atual, total: 3 });
      return resultado();
    }),
    reenviarPendentes: vi.fn(async () => undefined),
    esperar: vi.fn(async () => undefined),
    log: (m) => logs.push(m),
    ...over,
  };
  return { d, logs };
}

describe('processarSolicitacao', () => {
  it('sucesso: executa com competência/documentos do pedido, progresso a cada empresa, envia COM solicitacaoId e conclui', async () => {
    const { d } = criarDeps();
    const s = solicitacao({ documentos: ['08293377000198'] });

    expect(await processarSolicitacao(s, d)).toBe('concluida');

    expect(d.executar).toHaveBeenCalledWith(
      expect.objectContaining({ competencia: '2026-08', documentos: ['08293377000198'] }),
    );
    expect(vi.mocked(d.enviarProgresso).mock.calls).toEqual([
      ['sol-1', 0, 3],
      ['sol-1', 1, 3],
      ['sol-1', 2, 3],
      ['sol-1', 3, 3],
    ]);
    expect(d.enviarExecucao).toHaveBeenCalledWith({ ...execucao, solicitacaoId: 'sol-1' }, resultado().arquivoJson);
    expect(d.concluir).toHaveBeenCalledWith('sol-1', { execucaoId: 'exec-9' });
    // Ordem: o envio da execução vem ANTES do concluir (a guarda de /execucoes exige em_andamento).
    const ordemEnvio = vi.mocked(d.enviarExecucao).mock.invocationCallOrder[0]!;
    const ordemConcluir = vi.mocked(d.concluir).mock.invocationCallOrder[0]!;
    expect(ordemEnvio).toBeLessThan(ordemConcluir);
  });

  it('documentos null = carteira inteira (lista vazia para o miolo)', async () => {
    const { d } = criarDeps();
    await processarSolicitacao(solicitacao(), d);
    expect(d.executar).toHaveBeenCalledWith(expect.objectContaining({ documentos: [] }));
  });

  it('reenvia pendências antigas antes de começar', async () => {
    const { d } = criarDeps();
    await processarSolicitacao(solicitacao(), d);
    expect(vi.mocked(d.reenviarPendentes).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(d.executar).mock.invocationCallOrder[0]!,
    );
  });

  it('senha recusada (ErroLogin) ⇒ concluir com { erro }, sem enviar execução', async () => {
    const { d } = criarDeps({
      executar: vi.fn(async () => {
        throw new ErroLogin('Login recusado pelo portal: usuário ou senha inválidos. Confira ISS_CPF/ISS_SENHA.');
      }),
    });
    expect(await processarSolicitacao(solicitacao(), d)).toBe('falhou');
    expect(d.enviarExecucao).not.toHaveBeenCalled();
    expect(d.concluir).toHaveBeenCalledWith('sol-1', { erro: expect.stringMatching(/Login recusado/) });
  });

  it('mensagem de erro é redigida (CPF) e cortada em 1000 caracteres', async () => {
    const { d } = criarDeps({
      executar: vi.fn(async () => {
        throw new Error(`falhou para 12345678901 ${'x'.repeat(2000)}`);
      }),
      redigir: (m) => m.split('12345678901').join('[CPF]'),
    });
    await processarSolicitacao(solicitacao(), d);
    const { erro } = vi.mocked(d.concluir).mock.calls[0]![1] as { erro: string };
    expect(erro.startsWith('falhou para [CPF]')).toBe(true);
    expect(erro).toHaveLength(1000);
  });

  it('nenhuma empresa para buscar ⇒ falhou com o motivo (não fica presa em andamento)', async () => {
    const { d } = criarDeps({
      executar: vi.fn(async () =>
        resultado({ execucao: null, motivoSemExecucao: 'sem_alvos', avisos: ['Aviso: não são clientes ativos em faixa de faturamento: 99'] }),
      ),
    });
    expect(await processarSolicitacao(solicitacao({ documentos: ['99'] }), d)).toBe('falhou');
    expect(d.concluir).toHaveBeenCalledWith('sol-1', { erro: expect.stringMatching(/Nenhuma empresa.*99/) });
  });

  it('envio da execução falhou ⇒ falhou, avisando que o resultado será reenviado', async () => {
    const { d } = criarDeps({
      enviarExecucao: vi.fn(async () => {
        throw new ErroApi('Sem resposta do sistema (timeout)', null);
      }),
    });
    expect(await processarSolicitacao(solicitacao(), d)).toBe('falhou');
    expect(d.concluir).toHaveBeenCalledWith('sol-1', { erro: expect.stringMatching(/reenviado/) });
  });

  it('progresso 409 (operador cancelou) ⇒ para a leitura e NÃO conclui nem envia', async () => {
    const { d, logs } = criarDeps({
      enviarProgresso: vi.fn(async (_id: string, atual: number) => {
        if (atual === 1) throw new ErroApi('Sistema respondeu 409: não está em andamento', 409);
      }),
    });
    expect(await processarSolicitacao(solicitacao(), d)).toBe('cancelada');
    expect(d.enviarProgresso).toHaveBeenCalledTimes(2);
    expect(d.enviarExecucao).not.toHaveBeenCalled();
    expect(d.concluir).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/cancelada no sistema/);
  });

  it('falha de rede no progresso NÃO interrompe a leitura', async () => {
    const { d } = criarDeps({
      enviarProgresso: vi.fn(async () => {
        throw new ErroApi('Sem resposta do sistema', null);
      }),
    });
    expect(await processarSolicitacao(solicitacao(), d)).toBe('concluida');
    expect(d.concluir).toHaveBeenCalledWith('sol-1', { execucaoId: 'exec-9' });
  });

  it('concluir falha por rede: tenta 2x e segue sem lançar', async () => {
    const { d, logs } = criarDeps({
      concluir: vi.fn(async () => {
        throw new ErroApi('Sem resposta do sistema', null);
      }),
    });
    expect(await processarSolicitacao(solicitacao(), d)).toBe('concluida');
    expect(d.concluir).toHaveBeenCalledTimes(2);
    expect(logs.join('\n')).toMatch(/~10 minutos/);
  });
});

describe('vigiar — laço', () => {
  it('--vigiar: consulta a cada ciclo, espera 60 s quando não há nada e processa quando chega um pedido', async () => {
    const fila: (SolicitacaoIss | null)[] = [null, solicitacao(), null];
    let ciclos = 0;
    const { d } = criarDeps({ buscarProxima: vi.fn(async () => fila.shift() ?? null) });

    const codigo = await vigiar({ umaVez: false, continuar: () => ++ciclos <= 4 }, d);

    expect(codigo).toBe(0);
    expect(d.buscarProxima).toHaveBeenCalledTimes(3);
    expect(d.executar).toHaveBeenCalledTimes(1);
    expect(d.concluir).toHaveBeenCalledWith('sol-1', { execucaoId: 'exec-9' });
    // Esperou depois dos ciclos vazios; logo depois de processar, pergunta de novo sem esperar.
    expect(vi.mocked(d.esperar).mock.calls.every(([ms]) => ms === INTERVALO_VIGIAR_MS)).toBe(true);
    expect(INTERVALO_VIGIAR_MS).toBe(60_000);
  });

  it('--vigiar: erro ao consultar o sistema não derruba o laço', async () => {
    const respostas = [
      () => Promise.reject(new ErroApi('Sistema respondeu 503', 503)),
      () => Promise.resolve(solicitacao()),
    ];
    let ciclos = 0;
    const { d, logs } = criarDeps({
      buscarProxima: vi.fn(() => (respostas.shift() ?? (() => Promise.resolve(null)))()),
    });
    await vigiar({ umaVez: false, continuar: () => ++ciclos <= 3 }, d);
    expect(logs.join('\n')).toMatch(/Não consegui consultar o sistema/);
    expect(d.executar).toHaveBeenCalledTimes(1);
  });

  it('--uma-vez sem pedido: UMA consulta, nada executado, código 0, sem esperar', async () => {
    const { d, logs } = criarDeps();
    expect(await vigiar({ umaVez: true }, d)).toBe(0);
    expect(d.buscarProxima).toHaveBeenCalledTimes(1);
    expect(d.executar).not.toHaveBeenCalled();
    expect(d.esperar).not.toHaveBeenCalled();
    expect(logs).toContain('Nenhuma solicitação pendente.');
  });

  it('--uma-vez processa no máximo UMA e termina, mesmo com outra na fila', async () => {
    const { d } = criarDeps({
      buscarProxima: vi.fn().mockResolvedValueOnce(solicitacao()).mockResolvedValueOnce(solicitacao({ id: 'sol-2' })),
    });
    expect(await vigiar({ umaVez: true }, d)).toBe(0);
    expect(d.buscarProxima).toHaveBeenCalledTimes(1);
    expect(d.executar).toHaveBeenCalledTimes(1);
  });

  it('--uma-vez com falha de login ⇒ conclui com erro e sai com código 1', async () => {
    const { d } = criarDeps({
      buscarProxima: vi.fn(async () => solicitacao()),
      executar: vi.fn(async () => {
        throw new ErroLogin('Login recusado pelo portal');
      }),
    });
    expect(await vigiar({ umaVez: true }, d)).toBe(1);
    expect(d.concluir).toHaveBeenCalledWith('sol-1', { erro: 'Login recusado pelo portal' });
  });

  it('--uma-vez com o sistema fora do ar ⇒ código 1', async () => {
    const { d } = criarDeps({
      buscarProxima: vi.fn(async () => {
        throw new ErroApi('Sem resposta do sistema', null);
      }),
    });
    expect(await vigiar({ umaVez: true }, d)).toBe(1);
  });
});
