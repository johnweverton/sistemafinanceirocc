import { describe, it, expect, afterEach, vi } from 'vitest';
import { competenciaAnterior, competenciaAtual } from '../../src/lib/competencia';

// Story 12.2 (AC 2) — `competenciaAtual` consolida as 3 cópias idênticas que viviam em
// LoteContabilidadeDialog/GerarExecucao/FaturamentoEEmissao.
describe('competenciaAtual', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mês corrente da referência, com zero à esquerda', () => {
    expect(competenciaAtual(new Date(2026, 2, 17, 10, 0))).toBe('2026-03');
  });

  it('dezembro não vira 13 nem estoura o ano', () => {
    expect(competenciaAtual(new Date(2026, 11, 31, 10, 0))).toBe('2026-12');
  });

  it('janeiro (mês 0 do Date) vira "01", não "00"', () => {
    expect(competenciaAtual(new Date(2026, 0, 1, 10, 0))).toBe('2026-01');
  });

  it('sem argumento, lê o relógio do momento', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 25, 14, 30));
    expect(competenciaAtual()).toBe('2026-08');
  });

  it('segue o calendário LOCAL do operador, não o UTC', () => {
    // 31/08 às 21h no relógio de quem está usando a tela. Num fuso a oeste de Greenwich (BRT é
    // UTC-3) esse mesmo instante já é 01/09 em UTC — uma implementação com `getUTCMonth()`
    // devolveria '2026-09' e o campo abriria a competência errada justamente na virada do mês,
    // que é quando o fechamento acontece. Por isso `competenciaAtual` usa os getters locais,
    // ao contrário de `competenciaAnterior` (que roda no cron, em servidor UTC).
    const fimDoMesANoite = new Date(2026, 7, 31, 21, 0);
    expect(competenciaAtual(fimDoMesANoite)).toBe('2026-08');
    expect(fimDoMesANoite.getMonth()).toBe(7);
  });
});

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
