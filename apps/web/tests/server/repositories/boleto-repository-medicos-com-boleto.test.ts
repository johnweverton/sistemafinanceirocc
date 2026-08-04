// Teste de listarMedicosComBoletoAtivo (achado 2026-08-04, coordenadora financeira) — médicos
// com boleto emitido/pago numa competência, em QUALQUER execução (não só a atual), pra evitar
// reemitir boleto duplicado do mesmo médico no mesmo mês.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { listarMedicosComBoletoAtivo } from '@/server/repositories/boleto-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

beforeEach(() => vi.clearAllMocks());

describe('listarMedicosComBoletoAtivo', () => {
  it('devolve o conjunto de medico_id com boleto emitido/pago na competência', async () => {
    const builder = makeBuilder({
      data: [
        { execucao_resultados: { medico_id: 'm1' } },
        { execucao_resultados: { medico_id: 'm2' } },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(builder);

    const ids = await listarMedicosComBoletoAtivo('2026-06');

    expect(ids).toEqual(new Set(['m1', 'm2']));
    expect(builder.in).toHaveBeenCalledWith('status', ['emitido', 'pago']);
    expect(builder.eq).toHaveBeenCalledWith('execucao_resultados.execucoes.competencia', '2026-06');
  });

  it('médico com dois boletos na competência (duplicata pré-existente) aparece uma vez só (Set)', async () => {
    const builder = makeBuilder({
      data: [
        { execucao_resultados: { medico_id: 'm1' } },
        { execucao_resultados: { medico_id: 'm1' } },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(builder);

    const ids = await listarMedicosComBoletoAtivo('2026-06');
    expect(ids).toEqual(new Set(['m1']));
  });

  it('sem boletos na competência → conjunto vazio', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: [], error: null }));
    const ids = await listarMedicosComBoletoAtivo('2026-06');
    expect(ids.size).toBe(0);
  });

  it('erro do banco → propaga ApiError 500', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: null, error: { message: 'timeout' } }));
    await expect(listarMedicosComBoletoAtivo('2026-06')).rejects.toThrow();
  });
});
