// Testes do dashboard-repository (Story 4.5 + fix 0010) — views vw_dashboard_* via getSupabaseAdmin mockado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { resumoPorCompetencia, resumoPorMedico, resumoPorEmpresa, aging } from '@/server/repositories/dashboard-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    not: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

beforeEach(() => vi.clearAllMocks());

describe('resumoPorCompetencia', () => {
  it('mapeia snake→camel', async () => {
    mockFrom.mockReturnValue(makeBuilder({
      data: [{ competencia: '2026-06', qtd_boletos: 10, total_emitido: 5000, total_recebido: 3000,
        total_em_aberto: 1000, total_vencido: 1000, taxa_inadimplencia: 0.2 }],
      error: null,
    }));
    const res = await resumoPorCompetencia();
    expect(res[0]).toMatchObject({ competencia: '2026-06', totalEmitido: 5000, taxaInadimplencia: 0.2, qtdBoletos: 10 });
  });

  it('preserva a linha de rollup (competencia null = total geral)', async () => {
    mockFrom.mockReturnValue(makeBuilder({
      data: [{ competencia: null, qtd_boletos: 20, total_emitido: 9000, total_recebido: 5000,
        total_em_aberto: 2000, total_vencido: 2000, taxa_inadimplencia: 0.222 }],
      error: null,
    }));
    const res = await resumoPorCompetencia();
    expect(res[0]!.competencia).toBeNull();
    expect(res[0]!.taxaInadimplencia).toBeCloseTo(0.222);
  });

  it('aplica filtro .eq quando competência é passada', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorCompetencia('2026-06');
    expect(builder.eq).toHaveBeenCalledWith('competencia', '2026-06');
  });

  it('aplica .eq de conta_emissora quando contaEmissora é passada', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorCompetencia(undefined, 'cavalcante_viana');
    expect(builder.eq).toHaveBeenCalledWith('conta_emissora', 'cavalcante_viana');
  });

  it('sem contaEmissora aplica .is(null) em conta_emissora', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorCompetencia();
    expect(builder.is).toHaveBeenCalledWith('conta_emissora', null);
  });
});

describe('resumoPorMedico', () => {
  it('mapeia incluindo ticketMedio', async () => {
    mockFrom.mockReturnValue(makeBuilder({
      data: [{ medico_id: 'm1', nome: 'Dr. A', qtd_boletos: 4, total_emitido: 4000, total_recebido: 2000,
        total_em_aberto: 1000, total_vencido: 1000, taxa_inadimplencia: 0.25, ticket_medio: 1000 }],
      error: null,
    }));
    const res = await resumoPorMedico();
    expect(res[0]).toMatchObject({ medicoId: 'm1', nome: 'Dr. A', ticketMedio: 1000, taxaInadimplencia: 0.25 });
  });

  it('sem competência filtra o rollup (competencia IS NULL)', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorMedico();
    expect(builder.is).toHaveBeenCalledWith('competencia', null);
    expect(builder.eq).not.toHaveBeenCalled();
  });

  it('com competência filtra por .eq', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorMedico('2026-06');
    expect(builder.eq).toHaveBeenCalledWith('competencia', '2026-06');
    expect(builder.is).toHaveBeenCalledWith('conta_emissora', null);
  });

  it('aplica .eq de conta_emissora quando contaEmissora é passada', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorMedico(undefined, 'cc_solucoes');
    expect(builder.eq).toHaveBeenCalledWith('conta_emissora', 'cc_solucoes');
  });

  it('sem contaEmissora aplica .is(null) em conta_emissora', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorMedico();
    expect(builder.is).toHaveBeenCalledWith('conta_emissora', null);
  });
});

describe('resumoPorEmpresa', () => {
  it('mapeia snake→camel incluindo contaEmissora', async () => {
    mockFrom.mockReturnValue(makeBuilder({
      data: [{ conta_emissora: 'mc', competencia: '2026-06', qtd_boletos: 5, total_emitido: 2000,
        total_recebido: 1500, total_em_aberto: 300, total_vencido: 200, taxa_inadimplencia: 0.1 }],
      error: null,
    }));
    const res = await resumoPorEmpresa();
    expect(res[0]).toMatchObject({ contaEmissora: 'mc', competencia: '2026-06', totalEmitido: 2000 });
  });

  it('exclui rollup sem empresa via .not(conta_emissora, is, null)', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorEmpresa();
    expect(builder.not).toHaveBeenCalledWith('conta_emissora', 'is', null);
  });

  it('sem competência filtra o rollup por empresa (competencia IS NULL)', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorEmpresa();
    expect(builder.is).toHaveBeenCalledWith('competencia', null);
  });

  it('com competência filtra por .eq', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorEmpresa('2026-06');
    expect(builder.eq).toHaveBeenCalledWith('competencia', '2026-06');
  });

  it('aplica .eq de conta_emissora quando contaEmissora é passada', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await resumoPorEmpresa(undefined, 'mc');
    expect(builder.eq).toHaveBeenCalledWith('conta_emissora', 'mc');
  });
});

describe('aging', () => {
  it('mapeia as faixas', async () => {
    mockFrom.mockReturnValue(makeBuilder({
      data: [{ faixa: '0-30', qtd: 3, total: 900 }, { faixa: '60+', qtd: 1, total: 500 }],
      error: null,
    }));
    const res = await aging();
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ faixa: '0-30', qtd: 3, total: 900 });
  });

  it('sem competência filtra o rollup (competencia IS NULL)', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await aging();
    expect(builder.is).toHaveBeenCalledWith('competencia', null);
  });

  it('com competência filtra por .eq', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await aging('2026-06');
    expect(builder.eq).toHaveBeenCalledWith('competencia', '2026-06');
  });

  it('aplica .eq de conta_emissora quando contaEmissora é passada', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await aging(undefined, 'carmem_cavalcante');
    expect(builder.eq).toHaveBeenCalledWith('conta_emissora', 'carmem_cavalcante');
  });

  it('sem contaEmissora aplica .is(null) em conta_emissora', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await aging();
    expect(builder.is).toHaveBeenCalledWith('conta_emissora', null);
  });
});
