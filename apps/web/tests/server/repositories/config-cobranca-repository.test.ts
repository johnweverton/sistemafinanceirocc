// Testes do repositório de config_cobranca — leitura/escrita do singleton (Story 10.2:
// valor_consulta_pediatria). Mocka o client Supabase (arquivo bate em I/O real).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const mockUpsert = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import {
  lerConfig,
  atualizarConfig,
  lerValorConsultaPediatria,
  resolverCondicoes,
} from '../../../src/server/repositories/config-cobranca-repository';

const configBase = {
  diasVencimento: 30,
  multaPercent: null,
  jurosMesPercent: null,
  descontoPercent: null,
  descontoDias: null,
  valorConsultaPediatria: 3.0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect, upsert: mockUpsert });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockUpsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
});

describe('lerConfig', () => {
  it('mapeia valor_consulta_pediatria da linha para valorConsultaPediatria', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 1,
        dias_vencimento: 30,
        multa_percent: 2,
        juros_mes_percent: 1,
        desconto_percent: null,
        desconto_dias: null,
        valor_consulta_pediatria: 4.5,
      },
      error: null,
    });
    const config = await lerConfig();
    expect(config.valorConsultaPediatria).toBe(4.5);
  });

  it('linha existente SEM a coluna (pré-migration 0026) → default seguro 3.00', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 1, dias_vencimento: 30, multa_percent: null, juros_mes_percent: null, desconto_percent: null, desconto_dias: null },
      error: null,
    });
    const config = await lerConfig();
    expect(config.valorConsultaPediatria).toBe(3.0);
  });

  it('sem linha nenhuma (fallback total) → default 3.00', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const config = await lerConfig();
    expect(config.valorConsultaPediatria).toBe(3.0);
    expect(config.diasVencimento).toBe(30);
  });
});

describe('atualizarConfig', () => {
  it('grava valorConsultaPediatria como valor_consulta_pediatria no upsert', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 1,
        dias_vencimento: 45,
        multa_percent: null,
        juros_mes_percent: null,
        desconto_percent: null,
        desconto_dias: null,
        valor_consulta_pediatria: 3.5,
      },
      error: null,
    });
    const config = await atualizarConfig({
      diasVencimento: 45,
      multaPercent: null,
      jurosMesPercent: null,
      descontoPercent: null,
      descontoDias: null,
      valorConsultaPediatria: 3.5,
    });
    expect(config.valorConsultaPediatria).toBe(3.5);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ valor_consulta_pediatria: 3.5 }),
    );
  });
});

describe('resolverCondicoes — modoVencimento (Story 11.1-A)', () => {
  it('sem override → dias_corridos, diaFixoVencimento null', () => {
    const r = resolverCondicoes(configBase, null);
    expect(r.modoVencimento).toBe('dias_corridos');
    expect(r.diaFixoVencimento).toBeNull();
    expect(r.diasVencimento).toBe(30);
  });

  it('override com modoVencimento dia_fixo → prevalece sobre o default global', () => {
    const r = resolverCondicoes(configBase, {
      diasVencimento: null, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
      modoVencimento: 'dia_fixo', diaFixoVencimento: 10,
    });
    expect(r.modoVencimento).toBe('dia_fixo');
    expect(r.diaFixoVencimento).toBe(10);
  });

  it('override com modoVencimento dias_corridos explícito → diaFixoVencimento sempre null', () => {
    const r = resolverCondicoes(configBase, {
      diasVencimento: 15, multaPercent: null, jurosMesPercent: null, descontoPercent: null, descontoDias: null,
      modoVencimento: 'dias_corridos', diaFixoVencimento: 10, // ignorado: modo não é dia_fixo
    });
    expect(r.modoVencimento).toBe('dias_corridos');
    expect(r.diaFixoVencimento).toBeNull();
    expect(r.diasVencimento).toBe(15);
  });
});

describe('lerValorConsultaPediatria (usado pelo orquestrador)', () => {
  it('devolve só o número, delegando para lerConfig', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 1, dias_vencimento: 30, multa_percent: null, juros_mes_percent: null, desconto_percent: null, desconto_dias: null, valor_consulta_pediatria: 7 },
      error: null,
    });
    expect(await lerValorConsultaPediatria()).toBe(7);
  });
});
