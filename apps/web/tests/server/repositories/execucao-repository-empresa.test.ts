// Testes UNITÁRIOS do execucao-repository — parte agregada por empresa (Story 10.4b).
// Mock do cliente Supabase admin (sem DB real).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const capturado: { inserts: unknown[]; contribuicoesInserts: unknown[] } = { inserts: [], contribuicoesInserts: [] };
let contribuicoesArmazenadas: Record<string, unknown>[] = [];

vi.mock('../../../src/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => {
      if (table === 'execucao_resultados') {
        return {
          insert: vi.fn((payload: unknown) => {
            capturado.inserts.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: { id: 'resultado-empresa-1' }, error: null })),
              })),
            };
          }),
        };
      }
      if (table === 'execucao_resultado_contribuicoes') {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>[]) => {
            capturado.contribuicoesInserts.push(payload);
            return { error: null };
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: contribuicoesArmazenadas, error: null })),
            })),
          })),
        };
      }
      if (table === 'execucoes') {
        return {
          insert: vi.fn((payload: unknown) => {
            capturado.inserts.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: 'exec-1', ...(payload as Record<string, unknown>) },
                  error: null,
                })),
              })),
            };
          }),
        };
      }
      if (table === 'execucao_selecoes') {
        return { insert: vi.fn(async () => ({ error: null })) };
      }
      throw new Error(`tabela não mockada no teste: ${table}`);
    }),
  }),
}));

import {
  gravarResultadoEmpresa,
  gravarContribuicoes,
  listarContribuicoes,
  criarExecucao,
} from '../../../src/server/repositories/execucao-repository';

beforeEach(() => {
  capturado.inserts = [];
  capturado.contribuicoesInserts = [];
  contribuicoesArmazenadas = [];
});

describe('gravarResultadoEmpresa', () => {
  it('grava com medico_id null e empresa_id setado, devolve o id do resultado', async () => {
    const id = await gravarResultadoEmpresa('exec-1', 'emp-1', {
      nome: 'MEDISA',
      guias: 461,
      totalValor: 2955.01,
      status: 'ok',
      alertas: [],
      subtotalFaixa: '461 × R$6,41 (por guia)',
    });
    expect(id).toBe('resultado-empresa-1');
    const payload = capturado.inserts[0] as Record<string, unknown>;
    expect(payload.medico_id).toBeNull();
    expect(payload.empresa_id).toBe('emp-1');
    expect(payload.cpf).toBe('');
    expect(payload.nome).toBe('MEDISA');
    expect(payload.total_valor).toBe(2955.01);
    expect(payload.subtotais).toEqual([
      { classe: 'PRECO_PROPRIO', guias: 461, valor: 2955.01, faixa: '461 × R$6,41 (por guia)' },
    ]);
  });

  it('status alerta grava subtotais vazio (sem memória de cálculo chutada)', async () => {
    await gravarResultadoEmpresa('exec-1', 'emp-1', {
      nome: 'MEDISA',
      guias: 0,
      totalValor: 0,
      status: 'alerta',
      alertas: ['Modo preço próprio sem regra configurada — valor zerado, corrigir cadastro do médico.'],
      subtotalFaixa: '',
    });
    const payload = capturado.inserts[0] as Record<string, unknown>;
    expect(payload.subtotais).toEqual([]);
    expect(payload.status).toBe('alerta');
  });
});

describe('gravarContribuicoes', () => {
  it('grava uma linha por médico', async () => {
    await gravarContribuicoes('resultado-1', [
      { medicoId: 'm1', guias: 150, valor: 961.5 },
      { medicoId: 'm2', guias: 311, valor: 1993.51 },
    ]);
    expect(capturado.contribuicoesInserts).toHaveLength(1);
    const payload = capturado.contribuicoesInserts[0] as Record<string, unknown>[];
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ execucao_resultado_id: 'resultado-1', medico_id: 'm1', guias: 150 });
  });

  it('array vazio não chama insert', async () => {
    await gravarContribuicoes('resultado-1', []);
    expect(capturado.contribuicoesInserts).toHaveLength(0);
  });
});

describe('listarContribuicoes', () => {
  it('mapeia as contribuições em ordem decrescente de guias', async () => {
    contribuicoesArmazenadas = [
      { id: 'c1', execucao_resultado_id: 'resultado-1', medico_id: 'm2', guias: 311, valor: 1993.51, criado_em: '2026-07-20T00:00:00Z' },
      { id: 'c2', execucao_resultado_id: 'resultado-1', medico_id: 'm1', guias: 150, valor: 961.5, criado_em: '2026-07-20T00:00:00Z' },
    ];
    const contribuicoes = await listarContribuicoes('resultado-1');
    expect(contribuicoes).toHaveLength(2);
    expect(contribuicoes[0]).toMatchObject({ medicoId: 'm2', guias: 311, valor: 1993.51 });
  });
});

describe('criarExecucao — empresaId (Story 10.4b)', () => {
  it('grava empresa_id quando informado', async () => {
    await criarExecucao('2026-06', 'user-1', [
      { medicoId: 'm1', producaoExternaId: 'p1', producaoNome: 'Guias Cardíacas Junho' },
    ], 'emp-1');
    const payload = capturado.inserts.find((p) => (p as Record<string, unknown>).competencia) as Record<string, unknown>;
    expect(payload.empresa_id).toBe('emp-1');
  });

  it('empresa_id fica null quando não informado (execução normal, regressão)', async () => {
    await criarExecucao('2026-06', 'user-1', [
      { medicoId: 'm1', producaoExternaId: 'p1', producaoNome: 'Junho 2026' },
    ]);
    const payload = capturado.inserts.find((p) => (p as Record<string, unknown>).competencia) as Record<string, unknown>;
    expect(payload.empresa_id).toBeNull();
  });
});
