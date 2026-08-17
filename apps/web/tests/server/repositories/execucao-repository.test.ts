// Testes UNITÁRIOS do execucao-repository — mock do cliente Supabase admin (sem DB real).
// Verifica que gravarResultado e concluirExecucao montam o payload snake_case correto.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResultadoMedico } from '@cobranca/shared';

// Captura os payloads enviados ao Supabase para asserção.
const capturado: { inserts: unknown[]; updates: unknown[] } = { inserts: [], updates: [] };

function fakeQueryBuilder() {
  const builder = {
    insert: vi.fn((payload: unknown) => {
      capturado.inserts.push(payload);
      return {
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: 'resultado-fake-1' }, error: null })),
        })),
      };
    }),
    update: vi.fn((payload: unknown) => {
      capturado.updates.push(payload);
      return { eq: vi.fn(() => Promise.resolve({ error: null })) };
    }),
  };
  return builder;
}

vi.mock('../../../src/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: vi.fn(() => fakeQueryBuilder()) }),
}));

import {
  gravarResultado,
  concluirExecucao,
} from '../../../src/server/repositories/execucao-repository';

beforeEach(() => {
  capturado.inserts = [];
  capturado.updates = [];
});

describe('gravarResultado', () => {
  it('monta o payload snake_case incluindo guias_consolidado e medico_id', async () => {
    const r: ResultadoMedico = {
      cpf: '00000000001',
      nome: 'Dra. A',
      procedimentos: 17,
      cirurgias: 4,
      guias: 17,
      guiasConsolidado: 6,
      subtotais: [{ classe: 'HAPVIDA_CRED', guias: 17, valor: 263.59, faixa: 'até 30 guias' }],
      totalValor: 263.59,
      status: 'alerta',
      alertas: ['1 procedimento(s) sem valor ou descrição no sistema.'],
    };
    await gravarResultado('exec-1', 'm-1', r);

    expect(capturado.inserts).toHaveLength(1);
    const payload = capturado.inserts[0] as Record<string, unknown>;
    expect(payload.execucao_id).toBe('exec-1');
    expect(payload.medico_id).toBe('m-1');
    expect(payload.guias_consolidado).toBe(6);
    expect(payload.total_valor).toBe(263.59);
    expect(payload.status).toBe('alerta');
  });
});

describe('concluirExecucao', () => {
  it('grava status concluido, progresso 100 e os totais', async () => {
    await concluirExecucao('exec-1', {
      totalOk: 5,
      totalAlerta: 2,
      totalSemDados: 1,
      totalAcumulado: 3,
      totalGeralValor: 1234.56,
    });
    expect(capturado.updates).toHaveLength(1);
    const payload = capturado.updates[0] as Record<string, unknown>;
    expect(payload.status).toBe('concluido');
    expect(payload.progresso).toBe(100);
    expect(payload.total_ok).toBe(5);
    expect(payload.total_acumulado).toBe(3);
    expect(payload.total_geral_valor).toBe(1234.56);
  });
});
