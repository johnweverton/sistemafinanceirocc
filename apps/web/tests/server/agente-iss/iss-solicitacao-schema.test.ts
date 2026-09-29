// Validação das solicitações do ISS (Story 13.5, AC 7, 10–13): corpo do operador, dos três
// endpoints do agente e o `solicitacaoId` opcional de POST /execucoes.
import { describe, it, expect } from 'vitest';
import {
  conclusaoSolicitacaoIssSchema,
  idSolicitacaoIssSchema,
  novaSolicitacaoIssSchema,
  progressoSolicitacaoIssSchema,
  reivindicarSolicitacaoIssSchema,
} from '@/server/validation/iss-solicitacao-schema';
import { novaExecucaoIssSchema } from '@/server/validation/agente-iss-schema';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('novaSolicitacaoIssSchema (POST do operador)', () => {
  it('só a competência (carteira inteira) é recusada: a busca exige as empresas', () => {
    expect(novaSolicitacaoIssSchema.safeParse({ competencia: '2026-08' }).success).toBe(false);
  });

  it('documentos com máscara saem só com dígitos e sem repetição', () => {
    const r = novaSolicitacaoIssSchema.parse({
      competencia: '2026-08',
      documentos: ['08.293.377/0001-98', '08293377000198', '123.456.789-09'],
    });
    expect(r.documentos).toEqual(['08293377000198', '12345678909']);
  });

  it.each([
    [{ competencia: '08/2026' }],
    [{ competencia: '2026-13' }],
    [{}],
    [{ competencia: '2026-08', documentos: [] }],
    [{ competencia: '2026-08', documentos: ['123'] }],
    [{ competencia: '2026-08', solicitadoPor: UUID }],
    [{ competencia: '2026-08', status: 'concluida' }],
  ])('rejeita %j', (corpo) => {
    expect(novaSolicitacaoIssSchema.safeParse(corpo).success).toBe(false);
  });
});

describe('reivindicarSolicitacaoIssSchema (GET proxima)', () => {
  it('maquina opcional', () => {
    expect(reivindicarSolicitacaoIssSchema.parse({ maquina: null })).toEqual({ maquina: null });
    expect(reivindicarSolicitacaoIssSchema.parse({ maquina: ' ESCRITORIO ' })).toEqual({ maquina: 'ESCRITORIO' });
  });
  it('nome gigante é recusado', () => {
    expect(reivindicarSolicitacaoIssSchema.safeParse({ maquina: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('progressoSolicitacaoIssSchema', () => {
  it('aceita 0/0 e 34/90', () => {
    expect(progressoSolicitacaoIssSchema.safeParse({ atual: 0, total: 0 }).success).toBe(true);
    expect(progressoSolicitacaoIssSchema.parse({ atual: 34, total: 90 })).toEqual({ atual: 34, total: 90 });
  });
  it.each([
    [{ atual: 91, total: 90 }],
    [{ atual: -1, total: 90 }],
    [{ atual: 1.5, total: 90 }],
    [{ atual: '1', total: 90 }],
    [{ atual: 1 }],
    [{ atual: 1, total: 2, heartbeat: 'x' }],
  ])('rejeita %j', (corpo) => {
    expect(progressoSolicitacaoIssSchema.safeParse(corpo).success).toBe(false);
  });
});

describe('conclusaoSolicitacaoIssSchema (sucesso XOR falha)', () => {
  it('aceita { execucaoId } e { erro }', () => {
    expect(conclusaoSolicitacaoIssSchema.parse({ execucaoId: UUID })).toEqual({ execucaoId: UUID });
    expect(conclusaoSolicitacaoIssSchema.parse({ erro: ' senha errada ' })).toEqual({ erro: 'senha errada' });
  });
  it.each([
    [{}],
    [{ execucaoId: UUID, erro: 'x' }],
    [{ execucaoId: 'nao-e-uuid' }],
    [{ erro: '' }],
    [{ erro: 'x'.repeat(1001) }],
    [{ status: 'concluida' }],
  ])('rejeita %j', (corpo) => {
    expect(conclusaoSolicitacaoIssSchema.safeParse(corpo).success).toBe(false);
  });
});

describe('idSolicitacaoIssSchema', () => {
  it('só uuid', () => {
    expect(idSolicitacaoIssSchema.safeParse(UUID).success).toBe(true);
    expect(idSolicitacaoIssSchema.safeParse('abc').success).toBe(false);
  });
});

describe('novaExecucaoIssSchema — solicitacaoId (AC 13)', () => {
  const base = {
    competencia: '2026-08',
    iniciadoEm: '2026-09-21T10:00:00-03:00',
    capturas: [
      {
        clienteContabilidadeId: UUID,
        status: 'sem_escrituracao',
        capturadoEm: '2026-09-21T10:01:00-03:00',
      },
    ],
  };
  it('é opcional (execução do CLI comum continua igual)', () => {
    expect(novaExecucaoIssSchema.parse(base).solicitacaoId).toBeUndefined();
  });
  it('aceita uuid', () => {
    expect(novaExecucaoIssSchema.parse({ ...base, solicitacaoId: UUID }).solicitacaoId).toBe(UUID);
  });
  it('recusa o que não é uuid', () => {
    expect(novaExecucaoIssSchema.safeParse({ ...base, solicitacaoId: 'abc' }).success).toBe(false);
  });
});
