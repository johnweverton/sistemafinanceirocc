// Testes unitários do cliente-contabilidade-repository (Story 11.1) — mock do cliente Supabase
// admin. Cobre: criação, atualização com histórico, exclusão, leitura do histórico. Mesmo padrão
// de empresa-repository.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface EstadoFake {
  clientes: Map<string, Record<string, unknown>>;
  historicoInserido: Record<string, unknown>[];
  historicoPorCliente: Map<string, Record<string, unknown>[]>;
  historicoDeletadoPara: string[];
  clientesDeletadosIds: string[];
}

function novoEstado(): EstadoFake {
  return {
    clientes: new Map(),
    historicoInserido: [],
    historicoPorCliente: new Map(),
    historicoDeletadoPara: [],
    clientesDeletadosIds: [],
  };
}

let estado = novoEstado();

function clienteRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cc-1',
    nome: 'Padaria Bom Pão Ltda',
    regime_tributario: 'simples_nacional',
    modo_cobranca: 'faixa_faturamento',
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
    regra_preco_forma: 'faixa_faturamento',
    regra_preco_base: null,
    regra_preco_limiar: 5000,
    regra_preco_taxa: null,
    regra_preco_valor_fixo: null,
    regra_preco_valor_abaixo_limiar: 250,
    regra_preco_valor_acima_limiar: 480.56,
    adicional_ativo: false,
    adicional_valor: null,
    adicional_intervalo_meses: null,
    adicional_competencia_base: null,
    ativo: true,
    created_at: '2026-07-24T00:00:00Z',
    updated_at: '2026-07-24T00:00:00Z',
    ...overrides,
  };
}

vi.mock('../../../src/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => {
      if (table === 'clientes_contabilidade') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, id: string) => ({
              maybeSingle: vi.fn(async () => ({ data: estado.clientes.get(id) ?? null, error: null })),
            })),
            order: vi.fn(async () => ({
              data: Array.from(estado.clientes.values()),
              error: null,
            })),
          })),
          insert: vi.fn((row: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                const novo = clienteRow({ ...row, id: 'cc-novo' });
                estado.clientes.set('cc-novo', novo);
                return { data: novo, error: null };
              }),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn((_col: string, id: string) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const atual = estado.clientes.get(id)!;
                  const atualizado = { ...atual, ...patch };
                  estado.clientes.set(id, atualizado);
                  return { data: atualizado, error: null };
                }),
              })),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(async (_col: string, id: string) => {
              estado.clientesDeletadosIds.push(id);
              estado.clientes.delete(id);
              return { error: null };
            }),
          })),
        };
      }
      if (table === 'clientes_contabilidade_historico') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, clienteId: string) => ({
              order: vi.fn(async () => ({
                data: estado.historicoPorCliente.get(clienteId) ?? [],
                error: null,
              })),
            })),
          })),
          insert: vi.fn(async (rows: Record<string, unknown>[]) => {
            estado.historicoInserido.push(...rows);
            return { error: null };
          }),
          delete: vi.fn(() => ({
            eq: vi.fn(async (_col: string, clienteId: string) => {
              estado.historicoDeletadoPara.push(clienteId);
              return { error: null };
            }),
          })),
        };
      }
      throw new Error(`tabela não mockada no teste: ${table}`);
    }),
  }),
}));

import {
  criarClienteContabilidade,
  atualizarClienteContabilidade,
  excluirClienteContabilidade,
  historicoDoClienteContabilidade,
  listarClientesContabilidade,
} from '../../../src/server/repositories/cliente-contabilidade-repository';

beforeEach(() => {
  estado = novoEstado();
});

describe('criarClienteContabilidade', () => {
  it('cria e devolve o cliente mapeado', async () => {
    const cliente = await criarClienteContabilidade({
      nome: 'Padaria Bom Pão Ltda',
      regimeTributario: 'simples_nacional',
      modoCobranca: 'faixa_faturamento',
      cobranca: null,
      condicoes: null,
      regraPreco: {
        forma: 'faixa_faturamento',
        base: null,
        limiar: 5000,
        taxa: null,
        valorFixo: null,
        valorAbaixoLimiar: 250,
        valorAcimaLimiar: 480.56,
      },
      adicionalAtivo: false,
      adicionalValor: null,
      adicionalIntervaloMeses: null,
      adicionalCompetenciaBase: null,
      ativo: true,
    });
    expect(cliente.nome).toBe('Padaria Bom Pão Ltda');
    expect(cliente.regraPreco).toMatchObject({ forma: 'faixa_faturamento', valorAbaixoLimiar: 250 });
  });
});

describe('listarClientesContabilidade', () => {
  it('lista os clientes cadastrados', async () => {
    estado.clientes.set('cc-1', clienteRow());
    const clientes = await listarClientesContabilidade();
    expect(clientes).toHaveLength(1);
    expect(clientes[0]?.nome).toBe('Padaria Bom Pão Ltda');
  });
});

describe('atualizarClienteContabilidade', () => {
  it('exige motivo', async () => {
    estado.clientes.set('cc-1', clienteRow());
    await expect(
      atualizarClienteContabilidade('cc-1', { nome: 'Novo Nome' }, 'user-1', ''),
    ).rejects.toMatchObject({ code: 'MOTIVO_OBRIGATORIO' });
  });

  it('grava histórico só dos campos que mudaram', async () => {
    estado.clientes.set('cc-1', clienteRow());
    const atualizado = await atualizarClienteContabilidade(
      'cc-1',
      { nome: 'Padaria Bom Pão EIRELI' },
      'user-1',
      'Correção de razão social',
    );
    expect(atualizado.nome).toBe('Padaria Bom Pão EIRELI');
    expect(estado.historicoInserido).toHaveLength(1);
    expect(estado.historicoInserido[0]).toMatchObject({
      cliente_contabilidade_id: 'cc-1',
      campo_alterado: 'nome',
      valor_novo: 'Padaria Bom Pão EIRELI',
      motivo: 'Correção de razão social',
    });
  });

  it('404 quando o cliente não existe', async () => {
    await expect(
      atualizarClienteContabilidade('inexistente', { nome: 'X' }, 'u', 'motivo'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('excluirClienteContabilidade', () => {
  it('remove histórico e o cliente', async () => {
    estado.clientes.set('cc-1', clienteRow());
    await excluirClienteContabilidade('cc-1');
    expect(estado.historicoDeletadoPara).toEqual(['cc-1']);
    expect(estado.clientesDeletadosIds).toEqual(['cc-1']);
  });

  it('404 quando o cliente não existe', async () => {
    await expect(excluirClienteContabilidade('inexistente')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('historicoDoClienteContabilidade', () => {
  it('mapeia os eventos de histórico do cliente', async () => {
    estado.historicoPorCliente.set('cc-1', [
      {
        id: 'h1',
        cliente_contabilidade_id: 'cc-1',
        campo_alterado: 'nome',
        valor_anterior: 'Padaria Bom Pão',
        valor_novo: 'Padaria Bom Pão Ltda',
        alterado_por: 'user-1',
        motivo: 'Correção de razão social',
        alterado_em: '2026-07-24T00:00:00Z',
      },
    ]);
    const historico = await historicoDoClienteContabilidade('cc-1');
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ clienteContabilidadeId: 'cc-1', campoAlterado: 'nome' });
  });

  it('devolve [] quando não há histórico', async () => {
    const historico = await historicoDoClienteContabilidade('cc-sem-historico');
    expect(historico).toEqual([]);
  });
});
