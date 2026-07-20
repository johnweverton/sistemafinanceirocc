// Validação Zod de config_cobranca — Story 10.2 adiciona valorConsultaPediatria (global, > 0).
import { describe, it, expect } from 'vitest';
import { configCobrancaSchema } from '../../../src/server/validation/medico-schema';

const base = {
  diasVencimento: 30,
  multaPercent: null,
  jurosMesPercent: null,
  descontoPercent: null,
  descontoDias: null,
};

describe('configCobrancaSchema — valorConsultaPediatria (Story 10.2)', () => {
  it('valor positivo passa', () => {
    const r = configCobrancaSchema.safeParse({ ...base, valorConsultaPediatria: 3 });
    expect(r.success).toBe(true);
  });

  it('ausente → rejeita (campo obrigatório, sem default oculto)', () => {
    const r = configCobrancaSchema.safeParse(base);
    expect(r.success).toBe(false);
  });

  it('zero ou negativo → rejeita', () => {
    expect(configCobrancaSchema.safeParse({ ...base, valorConsultaPediatria: 0 }).success).toBe(false);
    expect(configCobrancaSchema.safeParse({ ...base, valorConsultaPediatria: -3 }).success).toBe(false);
  });
});
