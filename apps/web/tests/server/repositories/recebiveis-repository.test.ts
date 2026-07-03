// Testes do recebiveis-repository (Story 4.4) — vw_recebiveis via getSupabaseAdmin mockado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { listarRecebiveis } from '@/server/repositories/recebiveis-repository';

/** Builder "thenable" que registra as chamadas .eq e resolve o resultado no await. */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

beforeEach(() => vi.clearAllMocks());

describe('listarRecebiveis', () => {
  it('mapeia as linhas da view para Recebivel', async () => {
    const row = {
      boleto_id: 'b1', execucao_resultado_id: 'r1', id_externo: 'inv_1', competencia: '2026-06',
      medico_id: 'm1', nome: 'Dr. Teste', valor: 1500, vencimento: '2026-07-01', pago_em: null,
      valor_pago: null, emitido_em: '2026-06-01T00:00:00Z', status_derivado: 'em_aberto',
    };
    mockFrom.mockReturnValue(makeBuilder({ data: [row], error: null }));

    const res = await listarRecebiveis();
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ boletoId: 'b1', competencia: '2026-06', statusDerivado: 'em_aberto', valor: 1500 });
  });

  it('aplica filtros de competência e status como .eq', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    await listarRecebiveis({ competencia: '2026-06', statusDerivado: 'pago' });
    expect(builder.eq).toHaveBeenCalledWith('competencia', '2026-06');
    expect(builder.eq).toHaveBeenCalledWith('status_derivado', 'pago');
  });

  it('sem filtros → não chama .eq', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    await listarRecebiveis();
    expect(builder.eq).not.toHaveBeenCalled();
  });
});
