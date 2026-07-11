// Testes de listarBoletosPagosParaConciliacao (Story 8.2) — boletos pagos livres da conta,
// documento do pagador via join execucao_resultados→medicos, exclusão dos já conciliados.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { listarBoletosPagosParaConciliacao } from '@/server/repositories/boleto-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    like: vi.fn(() => builder),
    not: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

function rowBoleto(id: string, documento: string | null = '12345678901') {
  return {
    id,
    valor_pago: 1500,
    pago_em: '2026-07-08T09:00:00Z',
    execucao_resultados: { medicos: { pagador_documento: documento } },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('listarBoletosPagosParaConciliacao', () => {
  it('filtra conta + status pago e mapeia o documento do médico (join aninhado)', async () => {
    const builderOcupados = makeBuilder({ data: [], error: null });
    const builderBoletos = makeBuilder({ data: [rowBoleto('b1')], error: null });
    mockFrom.mockReturnValueOnce(builderOcupados).mockReturnValueOnce(builderBoletos);

    const r = await listarBoletosPagosParaConciliacao('mc');

    expect(r).toEqual([
      { boletoId: 'b1', valorPago: 1500, pagoEm: '2026-07-08T09:00:00Z', pagadorDocumento: '12345678901' },
    ]);
    expect(builderBoletos.eq).toHaveBeenCalledWith('conta_emissora', 'mc');
    expect(builderBoletos.eq).toHaveBeenCalledWith('status', 'pago');
    // Ocupados: só transações com status conciliado_%.
    expect(builderOcupados.like).toHaveBeenCalledWith('status_conciliacao', 'conciliado%');
  });

  it('boleto já conciliado com transação sai da lista (1↔1)', async () => {
    const builderOcupados = makeBuilder({ data: [{ boleto_id: 'b1' }], error: null });
    const builderBoletos = makeBuilder({
      data: [rowBoleto('b1'), rowBoleto('b2')],
      error: null,
    });
    mockFrom.mockReturnValueOnce(builderOcupados).mockReturnValueOnce(builderBoletos);

    const r = await listarBoletosPagosParaConciliacao('mc');
    expect(r.map((b) => b.boletoId)).toEqual(['b2']);
  });

  it('médico sem documento de pagador → pagadorDocumento null (cai na camada 2 do engine)', async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: [], error: null }))
      .mockReturnValueOnce(makeBuilder({ data: [rowBoleto('b1', null)], error: null }));

    const r = await listarBoletosPagosParaConciliacao('mc');
    expect(r[0]?.pagadorDocumento).toBeNull();
  });
});
