// Testes de revisarResultado (Fase de revisão de alerta) — getSupabaseAdmin mockado, sem banco real.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { revisarResultado } from '@/server/repositories/execucao-repository';

function makeBuilder(buscaResult: { data: unknown; error: unknown }, updateResult?: { data: unknown; error: unknown }) {
  const updatePayloads: unknown[] = [];
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(buscaResult)),
    update: vi.fn((payload: unknown) => {
      updatePayloads.push(payload);
      return builder;
    }),
    single: vi.fn(() => Promise.resolve(updateResult ?? { data: null, error: null })),
    _updatePayloads: updatePayloads,
  };
  return builder;
}

const resultadoAlerta = {
  id: 'r1', execucao_id: 'e1', medico_id: 'm1', cpf: '11111111111', nome: 'Dr. Teste',
  procedimentos: 1, cirurgias: 0, guias: 220, guias_consolidado: 220, subtotais: null,
  total_valor: 1190.89, status: 'alerta', alertas: ['VARIAÇÃO ALTA...'],
  status_original: null, revisado_por: null, revisado_em: null, motivo_revisao: null,
};

beforeEach(() => vi.clearAllMocks());

describe('revisarResultado', () => {
  it('atualiza status para ok e grava os campos de auditoria quando o resultado está em alerta', async () => {
    const builder = makeBuilder(
      { data: resultadoAlerta, error: null },
      { data: { ...resultadoAlerta, status: 'ok', status_original: 'alerta', revisado_por: 'u1', motivo_revisao: 'ok, confirmado' }, error: null },
    );
    mockFrom.mockReturnValue(builder);

    const resultado = await revisarResultado('r1', 'u1', 'ok, confirmado');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        status_original: 'alerta',
        revisado_por: 'u1',
        motivo_revisao: 'ok, confirmado',
      }),
    );
    expect(resultado.status).toBe('ok');
    expect(resultado.statusOriginal).toBe('alerta');
    expect(resultado.motivoRevisao).toBe('ok, confirmado');
  });

  it('rejeita com STATUS_INVALIDO quando o resultado não está em alerta', async () => {
    const builder = makeBuilder({ data: { ...resultadoAlerta, status: 'ok' }, error: null });
    mockFrom.mockReturnValue(builder);

    await expect(revisarResultado('r1', 'u1', 'motivo qualquer')).rejects.toMatchObject({
      status: 400,
      code: 'STATUS_INVALIDO',
    });
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('rejeita com 404 quando o resultado não existe', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    await expect(revisarResultado('r-inexistente', 'u1', 'motivo qualquer')).rejects.toMatchObject({
      status: 404,
      code: 'RESULTADO_NAO_ENCONTRADO',
    });
  });
});
