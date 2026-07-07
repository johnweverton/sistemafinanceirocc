// Testes de listarExecucoes/buscarExecucao enriquecendo iniciadoPorEmail (Fase 4).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

const mockResolverEmailPorId = vi.fn();
const mockResolverEmailsPorIds = vi.fn();
vi.mock('@/server/auth/resolver-email', () => ({
  resolverEmailPorId: (...a: unknown[]) => mockResolverEmailPorId(...a),
  resolverEmailsPorIds: (...a: unknown[]) => mockResolverEmailsPorIds(...a),
}));

import { listarExecucoes, buscarExecucao } from '@/server/repositories/execucao-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

const execucaoRow = {
  id: 'e1', competencia: '2026-06', iniciado_por: 'u1', iniciado_em: '2026-06-01T10:00:00Z',
  finalizado_em: null, status: 'concluido', progresso: 100, total_medicos: 1,
  total_ok: 1, total_alerta: 0, total_sem_dados: 0, total_geral_valor: 900,
};

beforeEach(() => vi.clearAllMocks());

describe('listarExecucoes — enriquecimento de iniciadoPorEmail', () => {
  it('resolve os e-mails de todos os autores em uma única chamada', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: [execucaoRow], error: null }));
    mockResolverEmailsPorIds.mockResolvedValue(new Map([['u1', 'autor@escritorio.com']]));

    const execucoes = await listarExecucoes();

    expect(mockResolverEmailsPorIds).toHaveBeenCalledWith(['u1']);
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]?.iniciadoPorEmail).toBe('autor@escritorio.com');
  });
});

describe('buscarExecucao — enriquecimento de iniciadoPorEmail', () => {
  it('pula a resolução enquanto a execução está processando', async () => {
    mockFrom.mockReturnValue(
      makeBuilder({ data: { ...execucaoRow, status: 'processando' }, error: null }),
    );

    const execucao = await buscarExecucao('e1');

    expect(mockResolverEmailPorId).not.toHaveBeenCalled();
    expect(execucao?.iniciadoPorEmail).toBeUndefined();
  });

  it('resolve o e-mail quando a execução já concluiu', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: execucaoRow, error: null }));
    mockResolverEmailPorId.mockResolvedValue('autor@escritorio.com');

    const execucao = await buscarExecucao('e1');

    expect(mockResolverEmailPorId).toHaveBeenCalledWith('u1');
    expect(execucao?.iniciadoPorEmail).toBe('autor@escritorio.com');
  });
});
