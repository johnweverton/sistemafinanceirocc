// Testes do repositório de config_relatorio_mensal — leitura/escrita do singleton (destinatários
// e dia de envio do relatório mensal automático). Mocka o client Supabase (arquivo bate em I/O real).
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

import { lerConfig, atualizarConfig } from '../../../src/server/repositories/config-relatorio-mensal-repository';

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect, upsert: mockUpsert });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockUpsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
});

describe('lerConfig', () => {
  it('mapeia a linha do banco para camelCase', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 1, emails: 'ceo@empresa.com', dia_envio: 5, habilitado: true },
      error: null,
    });
    const config = await lerConfig();
    expect(config).toEqual({ emails: 'ceo@empresa.com', diaEnvio: 5, habilitado: true });
  });

  it('sem linha nenhuma → default "nunca configurado" (desabilitado, sem e-mails, dia 1)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const config = await lerConfig();
    expect(config).toEqual({ emails: '', diaEnvio: 1, habilitado: false });
  });
});

describe('atualizarConfig', () => {
  it('grava camelCase como snake_case no upsert', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 1, emails: 'nova-ceo@empresa.com', dia_envio: 10, habilitado: true },
      error: null,
    });
    const config = await atualizarConfig({ emails: 'nova-ceo@empresa.com', diaEnvio: 10, habilitado: true });
    expect(config).toEqual({ emails: 'nova-ceo@empresa.com', diaEnvio: 10, habilitado: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, emails: 'nova-ceo@empresa.com', dia_envio: 10, habilitado: true }),
    );
  });
});
