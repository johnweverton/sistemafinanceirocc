// Testes de calcularVencimento — modo 'dias_corridos' (legado) e 'dia_fixo' (Story 11.1-A,
// Epic 11: clientes de contabilidade com vencimento fixo, ex.: dia 10, dia 12). Único ponto de
// cálculo reaproveitado por emitir-boleto.ts e cora-gateway.ts (mesma data nos dois lugares).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { calcularVencimento } from '@/server/gateway/vencimento';

function condicoes(overrides: Partial<Parameters<typeof calcularVencimento>[0]> = {}) {
  return { diasVencimento: 30, modoVencimento: 'dias_corridos' as const, diaFixoVencimento: null, ...overrides };
}

describe('calcularVencimento', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('modo dias_corridos (padrão): hoje + diasVencimento', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1, 12)); // 2026-07-01
    expect(calcularVencimento(condicoes({ diasVencimento: 5 }))).toBe('2026-07-06');
  });

  it('modo dia_fixo: dia ainda não chegou no mês corrente → usa o mês corrente', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 5, 12)); // 2026-07-05
    expect(calcularVencimento(condicoes({ modoVencimento: 'dia_fixo', diaFixoVencimento: 10 }))).toBe('2026-07-10');
  });

  it('modo dia_fixo: dia já passou (ou é hoje) → rola para o mês seguinte', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 10, 12)); // 2026-07-10, mesmo dia do vencimento
    expect(calcularVencimento(condicoes({ modoVencimento: 'dia_fixo', diaFixoVencimento: 10 }))).toBe('2026-08-10');

    vi.setSystemTime(new Date(2026, 6, 15, 12)); // 2026-07-15, já passou
    expect(calcularVencimento(condicoes({ modoVencimento: 'dia_fixo', diaFixoVencimento: 10 }))).toBe('2026-08-10');
  });

  it('modo dia_fixo: mês mais curto usa o último dia real (dia 31 em fevereiro)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 15, 12)); // 2026-02-15 (2026 não é bissexto: fevereiro tem 28 dias)
    expect(calcularVencimento(condicoes({ modoVencimento: 'dia_fixo', diaFixoVencimento: 31 }))).toBe('2026-02-28');
  });

  it('modo dia_fixo: rola de dezembro para janeiro do ano seguinte', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 20, 12)); // 2026-12-20
    expect(calcularVencimento(condicoes({ modoVencimento: 'dia_fixo', diaFixoVencimento: 10 }))).toBe('2027-01-10');
  });

  it('modo dia_fixo sem diaFixoVencimento → cai no fallback de dias corridos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1, 12));
    expect(calcularVencimento(condicoes({ modoVencimento: 'dia_fixo', diaFixoVencimento: null, diasVencimento: 3 }))).toBe(
      '2026-07-04',
    );
  });
});
