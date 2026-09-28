// Repositório das solicitações de busca no ISS (Story 13.5, AC 7–13) — cliente Supabase admin
// trocado por um banco em memória que reproduz o índice único parcial da 0062 e a FK de execucao_id.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarBanco, criarSupabaseFake, solicitacaoRow, type FakeBanco } from './fake-supabase-iss';

let banco: FakeBanco;
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => criarSupabaseFake(banco) }));

import {
  buscarSolicitacaoIssDaCompetencia,
  cancelarSolicitacaoIss,
  concluirSolicitacaoIss,
  criarSolicitacaoIss,
  exigirSolicitacaoIssEmAndamento,
  HEARTBEAT_EXPIRADO_MS,
  registrarProgressoSolicitacaoIss,
  reivindicarProximaSolicitacaoIss,
} from '@/server/repositories/iss-solicitacao-repository';

const USUARIO = '00000000-0000-4000-8000-0000000000aa';
const AGORA = new Date('2026-09-28T12:00:00.000Z');
const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

function semear(...linhas: Record<string, unknown>[]) {
  banco.tabelas.iss_solicitacoes!.push(...linhas.map((l) => solicitacaoRow(l)));
}
const linha = (id: string) => banco.tabelas.iss_solicitacoes!.find((s) => s.id === id)!;

beforeEach(() => {
  banco = criarBanco();
});

describe('criarSolicitacaoIss (AC 7)', () => {
  it('cria pendente, com quem pediu e documentos null para a carteira inteira', async () => {
    const r = await criarSolicitacaoIss({ competencia: '2026-08', solicitadoPor: USUARIO });
    expect(r.criada).toBe(true);
    expect(r.solicitacao).toMatchObject({
      competencia: '2026-08',
      status: 'pendente',
      solicitadoPor: USUARIO,
      documentos: null,
      progressoAtual: null,
    });
    expect(banco.tabelas.iss_solicitacoes).toHaveLength(1);
  });

  it('documentos preenchidos ficam gravados ("Tentar de novo" de uma empresa)', async () => {
    const r = await criarSolicitacaoIss({
      competencia: '2026-08',
      documentos: ['08293377000198'],
      solicitadoPor: USUARIO,
    });
    expect(r.solicitacao.documentos).toEqual(['08293377000198']);
  });

  it('idempotente: a segunda chamada devolve a MESMA ativa, sem duplicar', async () => {
    const primeira = await criarSolicitacaoIss({ competencia: '2026-08', solicitadoPor: USUARIO });
    const segunda = await criarSolicitacaoIss({
      competencia: '2026-08',
      documentos: ['08293377000198'],
      solicitadoPor: USUARIO,
    });
    expect(segunda.criada).toBe(false);
    expect(segunda.solicitacao.id).toBe(primeira.solicitacao.id);
    expect(banco.tabelas.iss_solicitacoes).toHaveLength(1);
  });

  it('em_andamento também bloqueia uma nova; competência diferente não', async () => {
    semear({ id: 'a1', status: 'em_andamento' });
    expect((await criarSolicitacaoIss({ competencia: '2026-08', solicitadoPor: USUARIO })).solicitacao.id).toBe('a1');
    expect((await criarSolicitacaoIss({ competencia: '2026-07', solicitadoPor: USUARIO })).criada).toBe(true);
  });

  it('terminadas não bloqueiam: concluída/falhou/cancelada ⇒ cria outra', async () => {
    semear({ id: 'c1', status: 'concluida' }, { id: 'f1', status: 'falhou' }, { id: 'x1', status: 'cancelada' });
    expect((await criarSolicitacaoIss({ competencia: '2026-08', solicitadoPor: USUARIO })).criada).toBe(true);
  });

  it('corrida: outra ativa gravada entre a checagem e o insert ⇒ 23505 tratado, devolve a vencedora', async () => {
    let inseriu = false;
    banco.antesDe = (op, tabela) => {
      if (op === 'insert' && tabela === 'iss_solicitacoes' && !inseriu) {
        inseriu = true;
        banco.tabelas.iss_solicitacoes!.push(solicitacaoRow({ id: 'vencedora' }));
      }
    };
    const r = await criarSolicitacaoIss({ competencia: '2026-08', solicitadoPor: USUARIO });
    expect(r).toMatchObject({ criada: false, solicitacao: { id: 'vencedora' } });
    expect(banco.tabelas.iss_solicitacoes).toHaveLength(1);
  });
});

describe('buscarSolicitacaoIssDaCompetencia (AC 8)', () => {
  it('prefere a ativa', async () => {
    semear(
      { id: 'velha', status: 'concluida', solicitado_em: minutosAtras(30) },
      { id: 'ativa', status: 'pendente', solicitado_em: minutosAtras(60) },
    );
    expect((await buscarSolicitacaoIssDaCompetencia('2026-08'))?.id).toBe('ativa');
  });

  it('sem ativa, a mais recente de qualquer status', async () => {
    semear(
      { id: 'antiga', status: 'falhou', solicitado_em: minutosAtras(90) },
      { id: 'recente', status: 'concluida', solicitado_em: minutosAtras(10) },
      { id: 'outro-mes', status: 'concluida', competencia: '2026-07', solicitado_em: minutosAtras(1) },
    );
    expect((await buscarSolicitacaoIssDaCompetencia('2026-08'))?.id).toBe('recente');
  });

  it('nada na competência ⇒ null', async () => {
    expect(await buscarSolicitacaoIssDaCompetencia('2026-08')).toBeNull();
  });
});

describe('cancelarSolicitacaoIss (AC 9)', () => {
  it.each(['pendente', 'em_andamento'])('cancela de %s e marca finalizado_em', async (status) => {
    semear({ id: 's1', status });
    const r = await cancelarSolicitacaoIss('s1', AGORA);
    expect(r).toMatchObject({ status: 'cancelada', finalizadoEm: AGORA.toISOString() });
  });

  it.each(['concluida', 'falhou', 'cancelada'])('%s ⇒ 422 (nada a cancelar), sem mudar nada', async (status) => {
    semear({ id: 's1', status });
    await expect(cancelarSolicitacaoIss('s1', AGORA)).rejects.toMatchObject({ status: 422 });
    expect(linha('s1').status).toBe(status);
  });

  it('inexistente ⇒ 404', async () => {
    await expect(cancelarSolicitacaoIss('nao-existe')).rejects.toMatchObject({ status: 404 });
  });
});

describe('reivindicarProximaSolicitacaoIss (AC 10)', () => {
  it('pega a pendente MAIS ANTIGA e a marca em_andamento com heartbeat, máquina e iniciado_em', async () => {
    semear(
      { id: 'nova', competencia: '2026-08', solicitado_em: minutosAtras(1) },
      { id: 'antiga', competencia: '2026-07', solicitado_em: minutosAtras(5) },
    );
    const r = await reivindicarProximaSolicitacaoIss('ESCRITORIO-01', AGORA);
    expect(r).toMatchObject({
      id: 'antiga',
      status: 'em_andamento',
      maquina: 'ESCRITORIO-01',
      heartbeatEm: AGORA.toISOString(),
      iniciadoEm: AGORA.toISOString(),
    });
    expect(linha('nova').status).toBe('pendente');
  });

  it('sem pendente, retoma em_andamento com heartbeat parado há mais de 10 min (preserva iniciado_em)', async () => {
    semear({
      id: 'caiu',
      status: 'em_andamento',
      heartbeat_em: minutosAtras(11),
      iniciado_em: minutosAtras(30),
      maquina: 'MAQUINA-VELHA',
    });
    const r = await reivindicarProximaSolicitacaoIss('ESCRITORIO-02', AGORA);
    expect(r).toMatchObject({
      id: 'caiu',
      status: 'em_andamento',
      maquina: 'ESCRITORIO-02',
      heartbeatEm: AGORA.toISOString(),
      iniciadoEm: minutosAtras(30),
    });
  });

  it('em_andamento com heartbeat recente NÃO é tomada ⇒ null (204)', async () => {
    semear({ id: 'viva', status: 'em_andamento', heartbeat_em: minutosAtras(9) });
    expect(await reivindicarProximaSolicitacaoIss(null, AGORA)).toBeNull();
    expect(linha('viva').heartbeat_em).toBe(minutosAtras(9));
  });

  it('pendente tem prioridade sobre uma abandonada', async () => {
    semear(
      { id: 'caiu', status: 'em_andamento', competencia: '2026-07', heartbeat_em: minutosAtras(60) },
      { id: 'pend', status: 'pendente', competencia: '2026-08' },
    );
    expect((await reivindicarProximaSolicitacaoIss(null, AGORA))?.id).toBe('pend');
  });

  it('nenhuma candidata ⇒ null; terminadas nunca são reivindicadas', async () => {
    semear({ id: 'c', status: 'concluida' }, { id: 'x', status: 'cancelada', competencia: '2026-07' });
    expect(await reivindicarProximaSolicitacaoIss(null, AGORA)).toBeNull();
  });

  it('corrida perdida (outro ciclo reivindicou entre o SELECT e o UPDATE) ⇒ null', async () => {
    semear({ id: 's1' });
    banco.antesDe = (op) => {
      if (op === 'update') Object.assign(linha('s1'), { status: 'em_andamento', maquina: 'OUTRA' });
    };
    expect(await reivindicarProximaSolicitacaoIss('ESTA', AGORA)).toBeNull();
    expect(linha('s1').maquina).toBe('OUTRA');
  });

  it('retomada: o agente "abandonado" deu sinal de vida no meio ⇒ não é tomada', async () => {
    semear({ id: 's1', status: 'em_andamento', heartbeat_em: minutosAtras(20) });
    banco.antesDe = (op) => {
      if (op === 'update') linha('s1').heartbeat_em = AGORA.toISOString();
    };
    expect(await reivindicarProximaSolicitacaoIss('ESTA', AGORA)).toBeNull();
  });

  it('limite de 10 minutos exposto para a UI/documentação', () => {
    expect(HEARTBEAT_EXPIRADO_MS).toBe(600_000);
  });
});

describe('registrarProgressoSolicitacaoIss (AC 11)', () => {
  it('grava atual/total e renova o heartbeat', async () => {
    semear({ id: 's1', status: 'em_andamento', heartbeat_em: minutosAtras(2) });
    const r = await registrarProgressoSolicitacaoIss('s1', { atual: 34, total: 90 }, AGORA);
    expect(r).toMatchObject({ progressoAtual: 34, progressoTotal: 90, heartbeatEm: AGORA.toISOString() });
  });

  it.each(['pendente', 'cancelada', 'concluida', 'falhou'])('%s ⇒ 409', async (status) => {
    semear({ id: 's1', status });
    await expect(registrarProgressoSolicitacaoIss('s1', { atual: 1, total: 2 })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('inexistente ⇒ 404', async () => {
    await expect(registrarProgressoSolicitacaoIss('x', { atual: 1, total: 2 })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('concluirSolicitacaoIss (AC 12)', () => {
  it('sucesso ⇒ concluida com execucao_id e finalizado_em', async () => {
    banco.tabelas.iss_execucoes_agente!.push({ id: 'exec-1', competencia: '2026-08' });
    semear({ id: 's1', status: 'em_andamento' });
    const r = await concluirSolicitacaoIss('s1', { execucaoId: 'exec-1' }, AGORA);
    expect(r).toMatchObject({
      status: 'concluida',
      execucaoId: 'exec-1',
      finalizadoEm: AGORA.toISOString(),
      mensagemErro: null,
    });
  });

  it('erro ⇒ falhou com a mensagem', async () => {
    semear({ id: 's1', status: 'em_andamento' });
    const r = await concluirSolicitacaoIss('s1', { erro: 'Login recusado pelo portal' }, AGORA);
    expect(r).toMatchObject({ status: 'falhou', mensagemErro: 'Login recusado pelo portal', execucaoId: null });
  });

  it.each(['pendente', 'cancelada', 'concluida'])('%s ⇒ 409, sem mudar nada', async (status) => {
    semear({ id: 's1', status });
    await expect(concluirSolicitacaoIss('s1', { erro: 'x' })).rejects.toMatchObject({ status: 409 });
    expect(linha('s1').status).toBe(status);
  });

  it('execução inexistente (FK) ⇒ 422', async () => {
    semear({ id: 's1', status: 'em_andamento' });
    await expect(concluirSolicitacaoIss('s1', { execucaoId: 'nao-existe' })).rejects.toMatchObject({
      status: 422,
    });
    expect(linha('s1').status).toBe('em_andamento');
  });

  it('[QA] execução de OUTRA competência ⇒ 422, solicitação continua em andamento', async () => {
    banco.tabelas.iss_execucoes_agente!.push({ id: 'exec-julho', competencia: '2026-07' });
    semear({ id: 's1', status: 'em_andamento', competencia: '2026-08' });
    await expect(concluirSolicitacaoIss('s1', { execucaoId: 'exec-julho' })).rejects.toMatchObject({
      status: 422,
      code: 'EXECUCAO_OUTRA_COMPETENCIA',
    });
    expect(linha('s1').status).toBe('em_andamento');
    expect(linha('s1').execucao_id).toBeNull();
  });

  it('depois de concluída, a competência aceita uma nova solicitação', async () => {
    semear({ id: 's1', status: 'em_andamento' });
    await concluirSolicitacaoIss('s1', { erro: 'x' });
    expect((await criarSolicitacaoIss({ competencia: '2026-08', solicitadoPor: USUARIO })).criada).toBe(true);
  });
});

describe('exigirSolicitacaoIssEmAndamento (guarda do AC 13)', () => {
  it('em_andamento passa', async () => {
    semear({ id: 's1', status: 'em_andamento' });
    await expect(exigirSolicitacaoIssEmAndamento('s1')).resolves.toBeUndefined();
  });

  it.each(['pendente', 'concluida', 'cancelada'])('%s ⇒ 422', async (status) => {
    semear({ id: 's1', status });
    await expect(exigirSolicitacaoIssEmAndamento('s1')).rejects.toMatchObject({ status: 422 });
  });

  it('inexistente ⇒ 422', async () => {
    await expect(exigirSolicitacaoIssEmAndamento('nao-existe')).rejects.toMatchObject({ status: 422 });
  });

  it('[QA] competência da execução diferente da solicitação ⇒ 422; igual passa', async () => {
    semear({ id: 's1', status: 'em_andamento', competencia: '2026-08' });
    await expect(exigirSolicitacaoIssEmAndamento('s1', '2026-07')).rejects.toMatchObject({ status: 422 });
    await expect(exigirSolicitacaoIssEmAndamento('s1', '2026-08')).resolves.toBeUndefined();
  });

  it('só lê: nenhuma escrita', async () => {
    semear({ id: 's1', status: 'em_andamento' });
    await exigirSolicitacaoIssEmAndamento('s1');
    expect(banco.log.every((l) => l.op === 'select')).toBe(true);
  });
});
