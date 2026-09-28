// Estado da busca no ISS pedida pelo sistema (Story 13.5, AC 19, 22, 23) — funções puras.
import { describe, it, expect } from 'vitest';
import type { CapturaIss, SolicitacaoIss } from '@cobranca/shared';
import {
  agentePareceDesligado,
  documentoParaBuscaIss,
  LIMITE_AGENTE_PARADO_MS,
  percentualSolicitacaoIss,
  podeTentarDeNovoNoIss,
  solicitacaoAtiva,
  textoSolicitacaoIss,
} from '@/lib/solicitacao-iss';
import { estadoPropostaIss } from '@/lib/proposta-iss';

const AGORA = new Date('2026-09-28T13:00:00.000Z');
const atras = (min: number, seg = 0) => new Date(AGORA.getTime() - min * 60_000 - seg * 1000).toISOString();

function solicitacao(over: Partial<SolicitacaoIss> = {}): SolicitacaoIss {
  return {
    id: 's1',
    competencia: '2026-08',
    documentos: null,
    status: 'pendente',
    solicitadoPor: 'u1',
    solicitadoEm: atras(1),
    iniciadoEm: null,
    finalizadoEm: null,
    progressoAtual: null,
    progressoTotal: null,
    execucaoId: null,
    mensagemErro: null,
    maquina: null,
    heartbeatEm: null,
    ...over,
  };
}

describe('solicitacaoAtiva', () => {
  it.each([
    ['pendente', true],
    ['em_andamento', true],
    ['concluida', false],
    ['falhou', false],
    ['cancelada', false],
  ] as const)('%s → %s', (status, esperado) => {
    expect(solicitacaoAtiva(solicitacao({ status }))).toBe(esperado);
  });
  it('null/undefined → false', () => {
    expect(solicitacaoAtiva(null)).toBe(false);
    expect(solicitacaoAtiva(undefined)).toBe(false);
  });
});

describe('agentePareceDesligado (AC 22)', () => {
  it('limite é de 3 minutos', () => {
    expect(LIMITE_AGENTE_PARADO_MS).toBe(180_000);
  });

  it('pendente há menos de 3 min → não; há mais → sim', () => {
    expect(agentePareceDesligado(solicitacao({ solicitadoEm: atras(2, 59) }), AGORA)).toBe(false);
    expect(agentePareceDesligado(solicitacao({ solicitadoEm: atras(3) }), AGORA)).toBe(false); // exatamente 3 min
    expect(agentePareceDesligado(solicitacao({ solicitadoEm: atras(3, 1) }), AGORA)).toBe(true);
  });

  it('em andamento: olha o heartbeat, não a hora do pedido', () => {
    const base = { status: 'em_andamento' as const, solicitadoEm: atras(30), iniciadoEm: atras(20) };
    expect(agentePareceDesligado(solicitacao({ ...base, heartbeatEm: atras(1) }), AGORA)).toBe(false);
    expect(agentePareceDesligado(solicitacao({ ...base, heartbeatEm: atras(4) }), AGORA)).toBe(true);
  });

  it('em andamento sem heartbeat: cai no iniciado_em, depois no solicitado_em', () => {
    expect(
      agentePareceDesligado(solicitacao({ status: 'em_andamento', iniciadoEm: atras(1), solicitadoEm: atras(30) }), AGORA),
    ).toBe(false);
    expect(agentePareceDesligado(solicitacao({ status: 'em_andamento', iniciadoEm: atras(5) }), AGORA)).toBe(true);
    expect(agentePareceDesligado(solicitacao({ status: 'em_andamento', solicitadoEm: atras(5) }), AGORA)).toBe(true);
  });

  it.each(['concluida', 'falhou', 'cancelada'] as const)('%s nunca acusa, por mais antiga que seja', (status) => {
    expect(agentePareceDesligado(solicitacao({ status, solicitadoEm: atras(600), heartbeatEm: atras(600) }), AGORA)).toBe(
      false,
    );
  });

  it('sem solicitação ou data ilegível → não', () => {
    expect(agentePareceDesligado(null, AGORA)).toBe(false);
    expect(agentePareceDesligado(solicitacao({ solicitadoEm: 'lixo' }), AGORA)).toBe(false);
  });
});

describe('textoSolicitacaoIss', () => {
  it('em andamento com progresso → "Buscando no ISS… 34/90"', () => {
    const s = solicitacao({ status: 'em_andamento', progressoAtual: 34, progressoTotal: 90 });
    expect(textoSolicitacaoIss(s)).toEqual({ texto: 'Buscando no ISS… 34/90', tom: 'andamento' });
    expect(percentualSolicitacaoIss(s)).toBe(38);
  });

  it('em andamento sem total ainda → sem números, sem barra', () => {
    const s = solicitacao({ status: 'em_andamento' });
    expect(textoSolicitacaoIss(s).texto).toBe('Buscando no ISS…');
    expect(percentualSolicitacaoIss(s)).toBeNull();
  });

  it('pedido de uma empresa só aparece no texto', () => {
    expect(textoSolicitacaoIss(solicitacao({ documentos: ['08293377000198'] })).texto).toMatch(/Na fila \(1 empresa\)/);
  });

  it('terminadas dizem a hora e o motivo da falha', () => {
    const fim = '2026-09-28T13:42:00.000Z';
    const hora = new Date(fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    expect(textoSolicitacaoIss(solicitacao({ status: 'concluida', finalizadoEm: fim }))).toEqual({
      texto: `Busca no ISS concluída às ${hora}.`,
      tom: 'sucesso',
    });
    const falha = textoSolicitacaoIss(solicitacao({ status: 'falhou', finalizadoEm: fim, mensagemErro: 'Login recusado' }));
    expect(falha).toEqual({ texto: `A busca no ISS falhou às ${hora}: Login recusado`, tom: 'aviso' });
    expect(textoSolicitacaoIss(solicitacao({ status: 'cancelada', finalizadoEm: fim })).tom).toBe('neutro');
  });
});

describe('"Tentar de novo" por empresa (AC 23)', () => {
  function captura(status: CapturaIss['status']): CapturaIss {
    return {
      id: 'c',
      execucaoId: 'e',
      clienteContabilidadeId: 'cc-1',
      competencia: '2026-08',
      status,
      valorServicosPrestados: status === 'capturado' ? 10 : null,
      quantidadeNotas: null,
      situacaoIss: null,
      competenciaFechada: true,
      inscricaoMunicipal: null,
      razaoSocialIss: null,
      alertas: [],
      mensagemErro: null,
      capturadoEm: '2026-09-28T10:00:00Z',
    };
  }

  it.each([
    ['nao_encontrado', true],
    ['erro', true],
    ['sem_escrituracao', false],
    ['capturado', false],
  ] as const)('captura %s → %s', (status, esperado) => {
    expect(podeTentarDeNovoNoIss(estadoPropostaIss(captura(status), undefined))).toBe(esperado);
  });

  it('sem captura nenhuma → não (o botão principal "Buscar no ISS" é que serve)', () => {
    expect(podeTentarDeNovoNoIss(estadoPropostaIss(undefined, undefined))).toBe(false);
  });

  it('documento do cadastro sai só com dígitos; inválido → null', () => {
    expect(documentoParaBuscaIss('08.293.377/0001-98')).toBe('08293377000198');
    expect(documentoParaBuscaIss('123.456.789-09')).toBe('12345678909');
    expect(documentoParaBuscaIss('123')).toBeNull();
    expect(documentoParaBuscaIss(null)).toBeNull();
    expect(documentoParaBuscaIss(undefined)).toBeNull();
  });
});
