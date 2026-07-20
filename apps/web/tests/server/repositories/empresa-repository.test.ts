// Testes unitários do empresa-repository (Story 10.4a) — mock do cliente Supabase admin.
// Cobre: criação, atualização com histórico, exclusão bloqueada por médicos vinculados,
// e leitura do histórico. Mesmo padrão de medico-repository.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface EstadoFake {
  empresas: Map<string, Record<string, unknown>>;
  medicosVinculadosCount: Map<string, number>;
  historicoInserido: Record<string, unknown>[];
  historicoPorEmpresa: Map<string, Record<string, unknown>[]>;
  historicoDeletadoPara: string[];
  empresasDeletadasIds: string[];
}

function novoEstado(): EstadoFake {
  return {
    empresas: new Map(),
    medicosVinculadosCount: new Map(),
    historicoInserido: [],
    historicoPorEmpresa: new Map(),
    historicoDeletadoPara: [],
    empresasDeletadasIds: [],
  };
}

let estado = novoEstado();

function empresaRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'emp-1',
    nome: 'MEDISA',
    pagador_tipo: null,
    pagador_documento: null,
    pagador_nome: null,
    email: null,
    whatsapp: null,
    cep: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    conta_emissora: 'mc',
    dias_vencimento: null,
    multa_percent: null,
    juros_mes_percent: null,
    desconto_percent: null,
    desconto_dias: null,
    regra_preco_forma: null,
    regra_preco_base: null,
    regra_preco_limiar: null,
    regra_preco_taxa: null,
    regra_preco_valor_fixo: null,
    ativo: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

vi.mock('../../../src/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => {
      if (table === 'empresas') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, id: string) => ({
              maybeSingle: vi.fn(async () => ({ data: estado.empresas.get(id) ?? null, error: null })),
            })),
            order: vi.fn(async () => ({
              data: Array.from(estado.empresas.values()),
              error: null,
            })),
          })),
          insert: vi.fn((row: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                const nova = empresaRow({ ...row, id: 'emp-nova' });
                estado.empresas.set('emp-nova', nova);
                return { data: nova, error: null };
              }),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn((_col: string, id: string) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const atual = estado.empresas.get(id)!;
                  const atualizada = { ...atual, ...patch };
                  estado.empresas.set(id, atualizada);
                  return { data: atualizada, error: null };
                }),
              })),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(async (_col: string, id: string) => {
              estado.empresasDeletadasIds.push(id);
              estado.empresas.delete(id);
              return { error: null };
            }),
          })),
        };
      }
      if (table === 'empresas_historico') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, empresaId: string) => ({
              order: vi.fn(async () => ({
                data: estado.historicoPorEmpresa.get(empresaId) ?? [],
                error: null,
              })),
            })),
          })),
          insert: vi.fn(async (rows: Record<string, unknown>[]) => {
            estado.historicoInserido.push(...rows);
            return { error: null };
          }),
          delete: vi.fn(() => ({
            eq: vi.fn(async (_col: string, empresaId: string) => {
              estado.historicoDeletadoPara.push(empresaId);
              return { error: null };
            }),
          })),
        };
      }
      if (table === 'medicos') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async (_col: string, empresaId: string) => ({
              count: estado.medicosVinculadosCount.get(empresaId) ?? 0,
              error: null,
            })),
          })),
        };
      }
      throw new Error(`tabela não mockada no teste: ${table}`);
    }),
  }),
}));

import {
  criarEmpresa,
  atualizarEmpresa,
  excluirEmpresa,
  historicoDaEmpresa,
  listarEmpresas,
} from '../../../src/server/repositories/empresa-repository';

beforeEach(() => {
  estado = novoEstado();
});

describe('criarEmpresa', () => {
  it('cria e devolve a empresa mapeada', async () => {
    const empresa = await criarEmpresa({
      nome: 'MEDISA',
      cobranca: null,
      condicoes: null,
      regraPreco: { forma: 'por_guia', base: null, limiar: null, taxa: 6.41, valorFixo: null },
      ativo: true,
    });
    expect(empresa.nome).toBe('MEDISA');
    expect(empresa.regraPreco).toMatchObject({ forma: 'por_guia', taxa: 6.41 });
  });
});

describe('listarEmpresas', () => {
  it('lista as empresas cadastradas', async () => {
    estado.empresas.set('emp-1', empresaRow());
    const empresas = await listarEmpresas();
    expect(empresas).toHaveLength(1);
    expect(empresas[0]?.nome).toBe('MEDISA');
  });
});

describe('atualizarEmpresa', () => {
  it('exige motivo', async () => {
    estado.empresas.set('emp-1', empresaRow());
    await expect(atualizarEmpresa('emp-1', { nome: 'Novo Nome' }, 'user-1', '')).rejects.toMatchObject({
      code: 'MOTIVO_OBRIGATORIO',
    });
  });

  it('grava histórico só dos campos que mudaram', async () => {
    estado.empresas.set('emp-1', empresaRow());
    const atualizada = await atualizarEmpresa('emp-1', { nome: 'MEDISA Ltda' }, 'user-1', 'Correção de razão social');
    expect(atualizada.nome).toBe('MEDISA Ltda');
    expect(estado.historicoInserido).toHaveLength(1);
    expect(estado.historicoInserido[0]).toMatchObject({
      empresa_id: 'emp-1',
      campo_alterado: 'nome',
      valor_novo: 'MEDISA Ltda',
      motivo: 'Correção de razão social',
    });
  });

  it('404 quando a empresa não existe', async () => {
    await expect(atualizarEmpresa('inexistente', { nome: 'X' }, 'u', 'motivo')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('excluirEmpresa', () => {
  it('remove histórico e a empresa quando não há médicos vinculados', async () => {
    estado.empresas.set('emp-1', empresaRow());
    await excluirEmpresa('emp-1');
    expect(estado.historicoDeletadoPara).toEqual(['emp-1']);
    expect(estado.empresasDeletadasIds).toEqual(['emp-1']);
  });

  it('bloqueia (POSSUI_MEDICOS_VINCULADOS) quando há médicos vinculados', async () => {
    estado.empresas.set('emp-2', empresaRow({ id: 'emp-2' }));
    estado.medicosVinculadosCount.set('emp-2', 2);
    await expect(excluirEmpresa('emp-2')).rejects.toMatchObject({ code: 'POSSUI_MEDICOS_VINCULADOS' });
    expect(estado.empresasDeletadasIds).toHaveLength(0);
  });

  it('404 quando a empresa não existe', async () => {
    await expect(excluirEmpresa('inexistente')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('historicoDaEmpresa', () => {
  it('mapeia os eventos de histórico da empresa', async () => {
    estado.historicoPorEmpresa.set('emp-1', [
      {
        id: 'h1',
        empresa_id: 'emp-1',
        campo_alterado: 'nome',
        valor_anterior: 'MEDISA',
        valor_novo: 'MEDISA Ltda',
        alterado_por: 'user-1',
        motivo: 'Correção de razão social',
        alterado_em: '2026-07-20T00:00:00Z',
      },
    ]);
    const historico = await historicoDaEmpresa('emp-1');
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ empresaId: 'emp-1', campoAlterado: 'nome', valorNovo: 'MEDISA Ltda' });
  });

  it('devolve [] quando não há histórico', async () => {
    const historico = await historicoDaEmpresa('emp-sem-historico');
    expect(historico).toEqual([]);
  });
});
