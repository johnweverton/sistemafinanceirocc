// Testes unitários do cliente-contabilidade-faturamento-repository (Story 11.2) — mock do
// cliente Supabase admin. Cobre: upsert por competência (lançar/atualizar), listar, buscar.
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface EstadoFake {
  faturamentos: Map<string, Record<string, unknown>>; // chave: `${clienteId}:${competencia}`
  /** Clientes cujo upsert deve falhar (simula erro do banco) — lote em massa, 2026-08-20. */
  falhaParaCliente: Set<string>;
  /** Cadastro dos clientes contábeis — só o necessário pra resolver `nome` (Story 12.4, AC 2). */
  clientes: Map<string, string>;
  /** Simula a busca de nomes caindo: o lote não pode ir junto (Story 12.4). */
  falhaAoBuscarClientes: boolean;
  /** Quantas vezes a tabela de clientes foi consultada — o caminho feliz não deve consultá-la. */
  buscasDeClientes: number;
}

function novoEstado(): EstadoFake {
  return {
    faturamentos: new Map(),
    falhaParaCliente: new Set(),
    clientes: new Map(),
    falhaAoBuscarClientes: false,
    buscasDeClientes: 0,
  };
}

let estado = novoEstado();

function chave(clienteId: string, competencia: string) {
  return `${clienteId}:${competencia}`;
}

vi.mock('../../../src/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => {
      if (table === 'clientes_contabilidade_faturamentos') {
        return {
          upsert: vi.fn((row: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                if (estado.falhaParaCliente.has(row.cliente_contabilidade_id as string)) {
                  return { data: null, error: { message: 'falha simulada de banco' } };
                }
                const k = chave(row.cliente_contabilidade_id as string, row.competencia as string);
                const existente = estado.faturamentos.get(k);
                const salvo = { id: existente?.id ?? `fat-${estado.faturamentos.size + 1}`, ...row };
                estado.faturamentos.set(k, salvo);
                return { data: salvo, error: null };
              }),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn((_col1: string, clienteId: string) => ({
              order: vi.fn(async () => ({
                data: Array.from(estado.faturamentos.values()).filter(
                  (f) => f.cliente_contabilidade_id === clienteId,
                ),
                error: null,
              })),
              eq: vi.fn((_col2: string, competencia: string) => ({
                maybeSingle: vi.fn(async () => ({
                  data: estado.faturamentos.get(chave(clienteId, competencia)) ?? null,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      // Story 12.4 (AC 2): as falhas do lote em massa passaram a carregar o NOME do cliente, o que
      // faz o repositório resolver os nomes numa query só nesta tabela.
      if (table === 'clientes_contabilidade') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async (_col: string, ids: string[]) => {
              estado.buscasDeClientes += 1;
              if (estado.falhaAoBuscarClientes) {
                return { data: null, error: { message: 'falha simulada ao buscar clientes' } };
              }
              return {
                data: ids
                  .filter((id) => estado.clientes.has(id))
                  .map((id) => ({ id, nome: estado.clientes.get(id) })),
                error: null,
              };
            }),
          })),
        };
      }
      throw new Error(`tabela não mockada no teste: ${table}`);
    }),
  }),
}));

import {
  lancarFaturamento,
  lancarFaturamentoLote,
  listarFaturamentos,
  buscarFaturamento,
} from '../../../src/server/repositories/cliente-contabilidade-faturamento-repository';

beforeEach(() => {
  estado = novoEstado();
});

describe('lancarFaturamento', () => {
  it('cria um novo lançamento', async () => {
    const f = await lancarFaturamento('cc-1', '2026-07', 4500, 'user-1');
    expect(f.competencia).toBe('2026-07');
    expect(f.faturamento).toBe(4500);
    expect(f.informadoPor).toBe('user-1');
  });

  it('relançar a mesma competência ATUALIZA (upsert), não duplica', async () => {
    await lancarFaturamento('cc-1', '2026-07', 4500, 'user-1');
    const atualizado = await lancarFaturamento('cc-1', '2026-07', 5200, 'user-2');
    expect(atualizado.faturamento).toBe(5200);
    expect(estado.faturamentos.size).toBe(1);
  });
});

// Story 12.4 (AC 2) — o diálogo de lote lista as falhas POR NOME; quem produz o nome é o
// repositório, não o front (o front só conhece os clientes que estão na tela).
describe('lancarFaturamentoLote', () => {
  beforeEach(() => {
    estado.clientes.set('cc-1', 'Padaria Bom Pão Ltda');
    estado.clientes.set('cc-2', 'Clínica Vida');
  });

  it('lote 100% ok: nenhuma falha e nenhuma busca de nome (caminho feliz não paga round-trip)', async () => {
    const r = await lancarFaturamentoLote(
      '2026-07',
      [
        { clienteContabilidadeId: 'cc-1', faturamento: 4500 },
        { clienteContabilidadeId: 'cc-2', faturamento: 9000 },
      ],
      'user-1',
    );
    expect(r).toEqual({ lancados: 2, falhas: [] });
    expect(estado.buscasDeClientes).toBe(0);
  });

  it('falha parcial: `falhas[]` traz o NOME do cliente junto do id e do motivo', async () => {
    estado.falhaParaCliente.add('cc-2');
    const r = await lancarFaturamentoLote(
      '2026-07',
      [
        { clienteContabilidadeId: 'cc-1', faturamento: 4500 },
        { clienteContabilidadeId: 'cc-2', faturamento: 9000 },
      ],
      'user-1',
    );
    expect(r.lancados).toBe(1);
    expect(r.falhas).toEqual([
      { clienteContabilidadeId: 'cc-2', nome: 'Clínica Vida', motivo: 'Falha ao lançar faturamento' },
    ]);
    // Uma query só pra todos os nomes, não uma por falha.
    expect(estado.buscasDeClientes).toBe(1);
  });

  it('cliente sumido do cadastro vira "—", não UUID cru', async () => {
    estado.clientes.delete('cc-2');
    estado.falhaParaCliente.add('cc-2');
    const r = await lancarFaturamentoLote(
      '2026-07',
      [{ clienteContabilidadeId: 'cc-2', faturamento: 9000 }],
      'user-1',
    );
    expect(r.falhas[0]?.nome).toBe('—');
  });

  it('busca de nomes falhando não derruba o lote — os lançamentos que deram certo continuam contados', async () => {
    estado.falhaParaCliente.add('cc-2');
    estado.falhaAoBuscarClientes = true;
    const r = await lancarFaturamentoLote(
      '2026-07',
      [
        { clienteContabilidadeId: 'cc-1', faturamento: 4500 },
        { clienteContabilidadeId: 'cc-2', faturamento: 9000 },
      ],
      'user-1',
    );
    expect(r.lancados).toBe(1);
    expect(r.falhas[0]).toMatchObject({ clienteContabilidadeId: 'cc-2', nome: '—' });
  });
});

describe('listarFaturamentos', () => {
  it('lista só os faturamentos do cliente informado', async () => {
    await lancarFaturamento('cc-1', '2026-06', 4000, 'user-1');
    await lancarFaturamento('cc-1', '2026-07', 4500, 'user-1');
    await lancarFaturamento('cc-2', '2026-07', 9000, 'user-1');
    const lista = await listarFaturamentos('cc-1');
    expect(lista).toHaveLength(2);
  });
});

describe('buscarFaturamento', () => {
  it('devolve o lançamento da competência quando existe', async () => {
    await lancarFaturamento('cc-1', '2026-07', 4500, 'user-1');
    const f = await buscarFaturamento('cc-1', '2026-07');
    expect(f?.faturamento).toBe(4500);
  });

  it('devolve null quando não há lançamento pra competência', async () => {
    const f = await buscarFaturamento('cc-1', '2026-08');
    expect(f).toBeNull();
  });
});
