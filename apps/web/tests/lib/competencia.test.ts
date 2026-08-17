import { describe, it, expect } from 'vitest';
import { competenciaAnterior } from '../../src/lib/competencia';

describe('competenciaAnterior', () => {
  it('mês do meio do ano → mês anterior, mesmo ano', () => {
    expect(competenciaAnterior(new Date('2026-09-01T06:00:00Z'))).toBe('2026-08');
  });

  it('janeiro → dezembro do ano anterior (virada de ano)', () => {
    expect(competenciaAnterior(new Date('2026-01-01T06:00:00Z'))).toBe('2025-12');
  });

  it('funciona em qualquer dia do mês, não só no dia 1', () => {
    expect(competenciaAnterior(new Date('2026-09-17T23:59:00Z'))).toBe('2026-08');
  });
});
