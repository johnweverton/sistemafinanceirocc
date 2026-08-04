// Testes de buscarResultadoPorId / atualizarResultado (migration 0041, achado real 2026-08-04) —
// getSupabaseAdmin mockado, sem banco real. Mesmo padrão de execucao-repository-revisar.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { buscarResultadoPorId, atualizarResultado } from '@/server/repositories/execucao-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const updatePayloads: unknown[] = [];
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    update: vi.fn((payload: unknown) => {
      updatePayloads.push(payload);
      return builder;
    }),
    single: vi.fn(() => Promise.resolve(result)),
    _updatePayloads: updatePayloads,
  };
  return builder;
}

const resultadoAlertaRow = {
  id: 'r1', execucao_id: 'e1', medico_id: 'm1', cpf: '11111111111', nome: 'JOSE NEIAS ARAUJO RIBEIRO',
  procedimentos: 38, cirurgias: 38, guias: 38, guias_consolidado: 17, subtotais: [],
  total_valor: 465.07, status: 'alerta', alertas: ['2 procedimento(s) sem código ou descrição na origem.'],
  status_original: null, revisado_por: null, revisado_em: null, motivo_revisao: null,
};

beforeEach(() => vi.clearAllMocks());

describe('buscarResultadoPorId', () => {
  it('devolve o resultado mapeado quando existe', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: resultadoAlertaRow, error: null }));
    const resultado = await buscarResultadoPorId('r1');
    expect(resultado?.guias).toBe(38);
    expect(resultado?.medicoId).toBe('m1');
  });

  it('devolve null quando não existe', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: null }));
    const resultado = await buscarResultadoPorId('r-inexistente');
    expect(resultado).toBeNull();
  });
});

describe('atualizarResultado', () => {
  it('grava o novo cálculo, limpa status_original/revisado_* antigos e marca recalculado_por/em', async () => {
    const builder = makeBuilder({
      data: {
        ...resultadoAlertaRow,
        guias: 19,
        guias_consolidado: 19,
        status: 'ok',
        alertas: [],
        recalculado_por: 'u1',
        recalculado_em: '2026-08-04T12:00:00Z',
      },
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    const novoCalculo = {
      cpf: '11111111111',
      nome: 'JOSE NEIAS ARAUJO RIBEIRO',
      procedimentos: 38,
      cirurgias: 17,
      guias: 19,
      guiasConsolidado: 19,
      subtotais: [{ classe: 'HAPVIDA_NAO_CRED' as const, guias: 19, valor: 250, faixa: 'até 50 guias' }],
      totalValor: 250,
      status: 'ok' as const,
      alertas: [] as string[],
    };

    const resultado = await atualizarResultado('r1', novoCalculo, 'u1');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        guias: 19,
        status: 'ok',
        status_original: null,
        revisado_por: null,
        revisado_em: null,
        motivo_revisao: null,
        recalculado_por: 'u1',
      }),
    );
    expect(resultado.guias).toBe(19);
    expect(resultado.recalculadoPor).toBe('u1');
  });
});
