// Repositório do agente ISS (Story 13.1, AC 2, 3, 5, 6, 7) — cliente Supabase admin mockado.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClienteContabilidade } from '@cobranca/shared';

interface Estado {
  execucoes: Record<string, unknown>[];
  capturas: Record<string, unknown>[];
  faturamentos: { cliente_contabilidade_id: string; competencia: string; faturamento: number }[];
  capturasExistentes: Record<string, unknown>[];
  falharInsertCapturas: boolean;
  tabelasEscritas: Set<string>;
  consultasFaturamento: number;
}
let estado: Estado;

function cliente(id: string, over: Partial<ClienteContabilidade> = {}): ClienteContabilidade {
  return {
    id,
    nome: `Cliente ${id}`,
    modoCobranca: 'faixa_faturamento',
    cobranca: { pagadorDocumento: '08.293.377/0001-98' },
    ativo: true,
    ...over,
  } as ClienteContabilidade;
}

const mockListar = vi.fn();
const mockListarPorIds = vi.fn();
vi.mock('@/server/repositories/cliente-contabilidade-repository', () => ({
  listarClientesContabilidade: (...a: unknown[]) => mockListar(...a),
  listarClientesContabilidadePorIds: (...a: unknown[]) => mockListarPorIds(...a),
}));

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: (tabela: string) => {
      if (tabela === 'iss_execucoes_agente') {
        return {
          insert: (row: Record<string, unknown>) => {
            estado.tabelasEscritas.add(tabela);
            return {
              select: () => ({
                single: async () => {
                  const salvo = { id: `exec-${estado.execucoes.length + 1}`, ...row };
                  estado.execucoes.push(salvo);
                  return { data: salvo, error: null };
                },
              }),
            };
          },
          delete: () => ({
            eq: async (_c: string, id: string) => {
              estado.execucoes = estado.execucoes.filter((e) => e.id !== id);
              return { error: null };
            },
          }),
        };
      }
      if (tabela === 'iss_capturas') {
        return {
          insert: async (rows: Record<string, unknown>[]) => {
            estado.tabelasEscritas.add(tabela);
            if (estado.falharInsertCapturas) return { error: { message: 'falha simulada' } };
            estado.capturas.push(...rows);
            return { error: null };
          },
          select: () => ({
            eq: (_c: string, competencia: string) => ({
              order: async () => ({
                data: estado.capturasExistentes
                  .filter((c) => c.competencia === competencia)
                  .sort((a, b) => String(b.capturado_em).localeCompare(String(a.capturado_em))),
                error: null,
              }),
            }),
          }),
        };
      }
      if (tabela === 'clientes_contabilidade_faturamentos') {
        return {
          select: () => ({
            in: (_c1: string, ids: string[]) => ({
              in: async (_c2: string, competencias: string[]) => {
                estado.consultasFaturamento += 1;
                return {
                  data: estado.faturamentos.filter(
                    (f) => ids.includes(f.cliente_contabilidade_id) && competencias.includes(f.competencia),
                  ),
                  error: null,
                };
              },
            }),
          }),
          upsert: () => {
            estado.tabelasEscritas.add(tabela);
            throw new Error('o agente nunca deve lançar faturamento oficial');
          },
        };
      }
      throw new Error(`tabela não mockada: ${tabela}`);
    },
  }),
}));

import {
  listarAlvosIss,
  registrarExecucaoIss,
  listarPropostasIssVigentes,
} from '@/server/repositories/iss-captura-repository';
import type { NovaExecucaoIssInput } from '@/server/validation/agente-iss-schema';

function captura(clienteContabilidadeId: string, over: Record<string, unknown> = {}) {
  return {
    clienteContabilidadeId,
    status: 'capturado' as const,
    valorServicosPrestados: 618.84,
    quantidadeNotas: 3,
    situacaoIss: 'Fechada - Normal',
    competenciaFechada: true,
    inscricaoMunicipal: null,
    razaoSocialIss: null,
    mensagemErro: null,
    capturadoEm: '2026-09-21T10:00:00-03:00',
    ...over,
  };
}

function execucao(competencia: string, capturas: ReturnType<typeof captura>[]): NovaExecucaoIssInput {
  return {
    competencia,
    iniciadoEm: '2026-09-21T10:00:00-03:00',
    finalizadoEm: null,
    maquina: null,
    versaoAgente: null,
    capturas,
    ciencias: [],
  } as NovaExecucaoIssInput;
}

beforeEach(() => {
  vi.clearAllMocks();
  estado = {
    execucoes: [],
    capturas: [],
    faturamentos: [],
    capturasExistentes: [],
    falharInsertCapturas: false,
    tabelasEscritas: new Set(),
    consultasFaturamento: 0,
  };
  mockListarPorIds.mockImplementation(async (ids: string[]) => ids.map((id) => cliente(id)));
});

describe('listarAlvosIss', () => {
  it('só faixa_faturamento; documento só dígitos; sem documento vai à parte', async () => {
    mockListar.mockResolvedValue([
      cliente('a'),
      cliente('b', { modoCobranca: 'fixo' }),
      cliente('c', { cobranca: null }),
      cliente('d', { cobranca: { pagadorDocumento: '123' } as ClienteContabilidade['cobranca'] }),
    ]);
    const r = await listarAlvosIss('2026-08');
    expect(mockListar).toHaveBeenCalledWith({ ativo: true });
    expect(r.alvos).toEqual([{ clienteContabilidadeId: 'a', nome: 'Cliente a', documento: '08293377000198' }]);
    expect(r.semDocumento.map((s) => s.clienteContabilidadeId)).toEqual(['c', 'd']);
  });
});

describe('registrarExecucaoIss', () => {
  it('grava execução + capturas com totais calculados no servidor', async () => {
    const r = await registrarExecucaoIss(
      execucao('2026-08', [
        captura('c1'),
        captura('c2', { status: 'nao_encontrado', valorServicosPrestados: null }),
      ]),
    );
    expect(r.totais).toEqual({ capturado: 1, nao_encontrado: 1, sem_escrituracao: 0, erro: 0 });
    expect(estado.execucoes).toHaveLength(1);
    expect(estado.capturas).toHaveLength(2);
    expect(estado.capturas[0]).toMatchObject({ execucao_id: r.execucaoId, competencia: '2026-08' });
  });

  it('cliente fora de faixa_faturamento ou inexistente → 422 sem gravar nada', async () => {
    mockListarPorIds.mockResolvedValue([cliente('c1', { modoCobranca: 'fixo' })]);
    await expect(registrarExecucaoIss(execucao('2026-08', [captura('c1'), captura('c9')]))).rejects.toMatchObject({
      status: 422,
      details: { clienteContabilidadeIds: ['c1', 'c9'] },
    });
    expect(estado.tabelasEscritas.size).toBe(0);
  });

  it('falha ao gravar capturas apaga a execução (compensação)', async () => {
    estado.falharInsertCapturas = true;
    await expect(registrarExecucaoIss(execucao('2026-08', [captura('c1')]))).rejects.toMatchObject({ status: 500 });
    expect(estado.execucoes).toHaveLength(0);
  });

  it('R5: zero em 2026-11 com histórico > 0 recebe alerta', async () => {
    estado.faturamentos.push({ cliente_contabilidade_id: 'c1', competencia: '2026-09', faturamento: 7200 });
    const r = await registrarExecucaoIss(
      execucao('2026-11', [captura('c1', { valorServicosPrestados: 0 }), captura('c2')]),
    );
    expect(r.comAlerta).toBe(1);
    expect(estado.capturas.find((c) => c.cliente_contabilidade_id === 'c1')?.alertas).toEqual([
      'possivel_nota_fora_escrituracao',
    ]);
    expect(estado.capturas.find((c) => c.cliente_contabilidade_id === 'c2')?.alertas).toEqual([]);
  });

  it('sem nenhum zero, não consulta histórico', async () => {
    await registrarExecucaoIss(execucao('2026-12', [captura('c1')]));
    expect(estado.consultasFaturamento).toBe(0);
  });

  it('nunca escreve em clientes_contabilidade_faturamentos (G3)', async () => {
    estado.faturamentos.push({ cliente_contabilidade_id: 'c1', competencia: '2026-10', faturamento: 100 });
    await registrarExecucaoIss(execucao('2026-11', [captura('c1', { valorServicosPrestados: 0 })]));
    expect(estado.tabelasEscritas.has('clientes_contabilidade_faturamentos')).toBe(false);
  });
});

describe('listarPropostasIssVigentes', () => {
  it('devolve só a captura mais recente por cliente, com numeric convertido', async () => {
    const base = {
      execucao_id: 'e', competencia: '2026-08', status: 'capturado', quantidade_notas: 1,
      situacao_iss: null, competencia_fechada: true, inscricao_municipal: null,
      razao_social_iss: null, alertas: [], mensagem_erro: null,
    };
    estado.capturasExistentes.push(
      { ...base, id: 'antiga', cliente_contabilidade_id: 'c1', valor_servicos_prestados: '100.00', capturado_em: '2026-09-20T10:00:00Z' },
      { ...base, id: 'nova', cliente_contabilidade_id: 'c1', valor_servicos_prestados: '618.84', capturado_em: '2026-09-21T10:00:00Z' },
      { ...base, id: 'outra', cliente_contabilidade_id: 'c2', valor_servicos_prestados: '5000.00', capturado_em: '2026-09-21T09:00:00Z' },
    );
    const vigentes = await listarPropostasIssVigentes('2026-08');
    expect(vigentes.map((v) => v.id).sort()).toEqual(['nova', 'outra']);
    expect(vigentes.find((v) => v.id === 'nova')?.valorServicosPrestados).toBe(618.84);
  });
});
