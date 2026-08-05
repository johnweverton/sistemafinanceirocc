// Testes de listarExecucoes enriquecendo medicoNome (busca por médico na tela de Emissões).
// Execuções "pontuais" (totalMedicos === 1) ganham o nome do médico via busca em LOTE em
// execucao_resultados; execuções em massa não. Lista vazia de pontuais não dispara a 2ª query.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

const mockResolverEmailsPorIds = vi.fn();
vi.mock('@/server/auth/resolver-email', () => ({
  resolverEmailPorId: vi.fn(),
  resolverEmailsPorIds: (...a: unknown[]) => mockResolverEmailsPorIds(...a),
}));

import { listarExecucoes } from '@/server/repositories/execucao-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

function execucaoRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'e1', competencia: '2026-06', iniciado_por: 'u1', iniciado_em: '2026-06-01T10:00:00Z',
    finalizado_em: null, status: 'concluido', progresso: 100, total_medicos: 1,
    total_ok: 1, total_alerta: 0, total_sem_dados: 0, total_geral_valor: 900,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolverEmailsPorIds.mockResolvedValue(new Map());
});

describe('listarExecucoes — enriquecimento de medicoNome', () => {
  it('execução pontual (totalMedicos === 1) ganha medicoNome via query em lote', async () => {
    const execucoesBuilder = makeBuilder({ data: [execucaoRow()], error: null });
    const resultadosBuilder = makeBuilder({
      data: [{ execucao_id: 'e1', nome: 'Dr. Alfa' }],
      error: null,
    });
    mockFrom.mockImplementation((table: string) =>
      table === 'execucoes' ? execucoesBuilder : resultadosBuilder,
    );

    const execucoes = await listarExecucoes();

    expect(resultadosBuilder.in).toHaveBeenCalledWith('execucao_id', ['e1']);
    expect(execucoes[0]?.medicoNome).toBe('Dr. Alfa');
  });

  it('execução em massa (totalMedicos > 1) não ganha medicoNome e não entra na busca em lote', async () => {
    const execucoesBuilder = makeBuilder({
      data: [execucaoRow({ id: 'e2', total_medicos: 120 })],
      error: null,
    });
    const resultadosBuilder = makeBuilder({ data: [], error: null });
    mockFrom.mockImplementation((table: string) =>
      table === 'execucoes' ? execucoesBuilder : resultadosBuilder,
    );

    const execucoes = await listarExecucoes();

    expect(resultadosBuilder.in).not.toHaveBeenCalled();
    expect(execucoes[0]?.medicoNome).toBeUndefined();
  });

  it('lista vazia de execuções pontuais não dispara a segunda query', async () => {
    const execucoesBuilder = makeBuilder({
      data: [execucaoRow({ id: 'e3', total_medicos: 50 })],
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'execucoes') return execucoesBuilder;
      throw new Error(`from('${table}') não deveria ser chamado — nenhuma execução pontual na lista`);
    });

    const execucoes = await listarExecucoes();

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(execucoes[0]?.medicoNome).toBeUndefined();
  });
});
