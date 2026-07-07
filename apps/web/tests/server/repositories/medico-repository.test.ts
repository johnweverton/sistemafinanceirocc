// Testes UNITÁRIOS de excluirMedico/excluirMedicos — mock do cliente Supabase admin.
// Cobre: bloqueio quando há execucao_resultados vinculado, exclusão em cascata do
// histórico de auditoria, e resiliência do lote a bloqueios individuais.
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface EstadoFake {
  medicos: Map<string, Record<string, unknown>>;
  execucaoCounts: Map<string, number>;
  historicoDeletadoPara: string[];
  medicosDeletadosIds: string[];
}

function novoEstado(): EstadoFake {
  return {
    medicos: new Map(),
    execucaoCounts: new Map(),
    historicoDeletadoPara: [],
    medicosDeletadosIds: [],
  };
}

let estado = novoEstado();

function medicoRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'med-1',
    cpf: null,
    nome: 'Dr. Teste',
    especialidade: null,
    status_hapvida: 'credenciado',
    faz_outros_hospitais: false,
    faz_imobilizacoes: false,
    modo_mudanca_data: 'nao',
    colaborador_responsavel: null,
    ativo: true,
    necessita_configuracao: false,
    external_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

vi.mock('../../../src/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => {
      if (table === 'medicos') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, id: string) => ({
              maybeSingle: vi.fn(async () => ({ data: estado.medicos.get(id) ?? null, error: null })),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(async (_col: string, id: string) => {
              estado.medicosDeletadosIds.push(id);
              estado.medicos.delete(id);
              return { error: null };
            }),
          })),
        };
      }
      if (table === 'execucao_resultados') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async (_col: string, medicoId: string) => ({
              count: estado.execucaoCounts.get(medicoId) ?? 0,
              error: null,
            })),
          })),
        };
      }
      if (table === 'medicos_historico') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(async (_col: string, medicoId: string) => {
              estado.historicoDeletadoPara.push(medicoId);
              return { error: null };
            }),
          })),
        };
      }
      throw new Error(`tabela não mockada no teste: ${table}`);
    }),
  }),
}));

import { excluirMedico, excluirMedicos } from '../../../src/server/repositories/medico-repository';

beforeEach(() => {
  estado = novoEstado();
});

describe('excluirMedico', () => {
  it('remove histórico e o médico quando não há execuções vinculadas', async () => {
    estado.medicos.set('med-1', medicoRow({ id: 'med-1' }));

    await excluirMedico('med-1');

    expect(estado.historicoDeletadoPara).toEqual(['med-1']);
    expect(estado.medicosDeletadosIds).toEqual(['med-1']);
    expect(estado.medicos.has('med-1')).toBe(false);
  });

  it('bloqueia (POSSUI_EXECUCOES) quando o médico tem execucao_resultados', async () => {
    estado.medicos.set('med-2', medicoRow({ id: 'med-2', nome: 'Dra. Com Histórico' }));
    estado.execucaoCounts.set('med-2', 3);

    await expect(excluirMedico('med-2')).rejects.toMatchObject({ code: 'POSSUI_EXECUCOES' });
    expect(estado.historicoDeletadoPara).toHaveLength(0);
    expect(estado.medicosDeletadosIds).toHaveLength(0);
  });

  it('404 quando o médico não existe', async () => {
    await expect(excluirMedico('inexistente')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('excluirMedicos', () => {
  it('exclui os elegíveis e reporta bloqueados sem abortar o lote', async () => {
    estado.medicos.set('med-a', medicoRow({ id: 'med-a', nome: 'Sem histórico' }));
    estado.medicos.set('med-b', medicoRow({ id: 'med-b', nome: 'Com histórico' }));
    estado.execucaoCounts.set('med-b', 1);

    const resultado = await excluirMedicos(['med-a', 'med-b', 'nao-existe']);

    expect(resultado.excluidos).toBe(1);
    expect(estado.medicos.has('med-a')).toBe(false);
    expect(resultado.bloqueados).toHaveLength(2);
    expect(resultado.bloqueados.find((b) => b.id === 'med-b')).toMatchObject({
      nome: 'Com histórico',
      motivo: expect.stringContaining('não pode ser excluído'),
    });
    expect(resultado.bloqueados.find((b) => b.id === 'nao-existe')).toMatchObject({
      motivo: 'Médico não encontrado',
    });
  });
});
