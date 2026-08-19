// Testes unitários do cliente-contabilidade-faturamento-repository (Story 11.2) — mock do
// cliente Supabase admin. Cobre: upsert por competência (lançar/atualizar), listar, buscar.
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface EstadoFake {
  faturamentos: Map<string, Record<string, unknown>>; // chave: `${clienteId}:${competencia}`
  /** Clientes cujo upsert deve falhar (simula erro do banco) — lote em massa, 2026-08-20. */
  falhaParaCliente: Set<string>;
}

function novoEstado(): EstadoFake {
  return { faturamentos: new Map(), falhaParaCliente: new Set() };
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
