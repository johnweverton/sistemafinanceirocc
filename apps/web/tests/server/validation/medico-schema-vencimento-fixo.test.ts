// Testes de condicoesCobrancaSchema — modo de vencimento (Story 11.1-A, Epic 11): alternativa
// 'dia_fixo' a 'dias_corridos' para clientes de contabilidade com vencimento em dia fixo do mês
// (ex.: dia 10, dia 12). Schema compartilhado por médico/empresa/cliente contábil.
import { describe, it, expect } from 'vitest';
import { condicoesCobrancaSchema } from '@/server/validation/medico-schema';

describe('condicoesCobrancaSchema — modoVencimento (Story 11.1-A)', () => {
  it('ausente → default "dias_corridos", diaFixoVencimento null', () => {
    const r = condicoesCobrancaSchema.parse({});
    expect(r.modoVencimento).toBe('dias_corridos');
    expect(r.diaFixoVencimento).toBeNull();
  });

  it('"dias_corridos" nunca exige diaFixoVencimento', () => {
    const r = condicoesCobrancaSchema.safeParse({ modoVencimento: 'dias_corridos', diasVencimento: 30 });
    expect(r.success).toBe(true);
  });

  it('"dia_fixo" sem diaFixoVencimento → rejeita', () => {
    const r = condicoesCobrancaSchema.safeParse({ modoVencimento: 'dia_fixo' });
    expect(r.success).toBe(false);
  });

  it('"dia_fixo" com diaFixoVencimento 1–31 → aceita', () => {
    const r = condicoesCobrancaSchema.safeParse({ modoVencimento: 'dia_fixo', diaFixoVencimento: 10 });
    expect(r.success).toBe(true);
  });

  it('diaFixoVencimento fora de 1–31 → rejeita (independente do modo)', () => {
    expect(
      condicoesCobrancaSchema.safeParse({ modoVencimento: 'dia_fixo', diaFixoVencimento: 0 }).success,
    ).toBe(false);
    expect(
      condicoesCobrancaSchema.safeParse({ modoVencimento: 'dia_fixo', diaFixoVencimento: 32 }).success,
    ).toBe(false);
  });

  it('modoVencimento inválido é rejeitado', () => {
    expect(condicoesCobrancaSchema.safeParse({ modoVencimento: 'semanal' }).success).toBe(false);
  });
});
