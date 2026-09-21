// Guarda R5 do agente ISS (Story 13.1, AC 5) — função pura.
import { describe, it, expect } from 'vitest';
import {
  alertasDaCapturaIss,
  competenciasAnteriores,
} from '@/server/engine/alertas-captura-iss';

const capturado = (competencia: string, valor: number) => ({
  competencia,
  status: 'capturado' as const,
  valorServicosPrestados: valor,
});

describe('alertasDaCapturaIss (R5)', () => {
  it('zero a partir de 2026-11 com histórico > 0 → possivel_nota_fora_escrituracao', () => {
    expect(alertasDaCapturaIss(capturado('2026-11', 0), [0, 3200])).toEqual([
      'possivel_nota_fora_escrituracao',
    ]);
  });

  it('antes do Emissor Nacional (2026-10) um zero não alerta', () => {
    expect(alertasDaCapturaIss(capturado('2026-10', 0), [3200])).toEqual([]);
  });

  it('zero sem histórico, ou com histórico todo zerado, não alerta', () => {
    expect(alertasDaCapturaIss(capturado('2026-12', 0), [])).toEqual([]);
    expect(alertasDaCapturaIss(capturado('2026-12', 0), [0, 0])).toEqual([]);
  });

  it('valor > 0 nunca alerta', () => {
    expect(alertasDaCapturaIss(capturado('2027-01', 0.01), [9000])).toEqual([]);
  });

  it('só vale para status capturado', () => {
    expect(
      alertasDaCapturaIss(
        { competencia: '2026-12', status: 'sem_escrituracao', valorServicosPrestados: null },
        [9000],
      ),
    ).toEqual([]);
  });
});

describe('competenciasAnteriores', () => {
  it('atravessa a virada de ano', () => {
    expect(competenciasAnteriores('2027-02', 3)).toEqual(['2027-01', '2026-12', '2026-11']);
  });
});
