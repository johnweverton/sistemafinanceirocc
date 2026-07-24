import { describe, it, expect } from 'vitest';
import { cicloAdicionalVencendoNaCompetencia } from '../../src/lib/adicional-semestral';

describe('cicloAdicionalVencendoNaCompetencia (Story 11.4)', () => {
  it('a própria competência base bate o ciclo', () => {
    expect(cicloAdicionalVencendoNaCompetencia('2026-01', 6, '2026-01')).toBe(true);
  });

  it('6 meses depois da base bate o ciclo', () => {
    expect(cicloAdicionalVencendoNaCompetencia('2026-01', 6, '2026-07')).toBe(true);
  });

  it('12 meses depois da base (2 ciclos) bate o ciclo', () => {
    expect(cicloAdicionalVencendoNaCompetencia('2026-01', 6, '2027-01')).toBe(true);
  });

  it('3 meses depois da base NÃO bate o ciclo', () => {
    expect(cicloAdicionalVencendoNaCompetencia('2026-01', 6, '2026-04')).toBe(false);
  });

  it('competência antes da base nunca bate (retorna false, não negativo)', () => {
    expect(cicloAdicionalVencendoNaCompetencia('2026-07', 6, '2026-01')).toBe(false);
  });

  it('competência ou base malformada devolve false, nunca lança', () => {
    expect(cicloAdicionalVencendoNaCompetencia('', 6, '2026-01')).toBe(false);
    expect(cicloAdicionalVencendoNaCompetencia('2026-01', 6, 'invalido')).toBe(false);
  });
});
