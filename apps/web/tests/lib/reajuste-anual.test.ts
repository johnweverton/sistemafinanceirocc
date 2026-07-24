import { describe, it, expect } from 'vitest';
import { reajusteAnualPendente } from '../../src/lib/reajuste-anual';

describe('reajusteAnualPendente (Story 11.5)', () => {
  const hoje = new Date('2026-07-24T00:00:00Z');

  it('cliente cadastrado há menos de 12 meses, nunca reajustado → não pendente', () => {
    expect(reajusteAnualPendente([], '2026-01-01T00:00:00Z', hoje)).toBe(false);
  });

  it('cliente cadastrado há 12+ meses, nunca reajustado → pendente', () => {
    expect(reajusteAnualPendente([], '2025-01-01T00:00:00Z', hoje)).toBe(true);
  });

  it('regraPreco alterada há poucos meses → não pendente, mesmo com cadastro antigo', () => {
    const historico = [{ campoAlterado: 'regraPreco', alteradoEm: '2026-02-01T00:00:00Z' }];
    expect(reajusteAnualPendente(historico, '2020-01-01T00:00:00Z', hoje)).toBe(false);
  });

  it('regraPreco alterada há 12+ meses → pendente', () => {
    const historico = [{ campoAlterado: 'regraPreco', alteradoEm: '2025-01-01T00:00:00Z' }];
    expect(reajusteAnualPendente(historico, '2020-01-01T00:00:00Z', hoje)).toBe(true);
  });

  it('usa a alteração de regraPreco MAIS RECENTE, ignorando outras alterações de campo', () => {
    const historico = [
      { campoAlterado: 'regraPreco', alteradoEm: '2024-01-01T00:00:00Z' },
      { campoAlterado: 'nome', alteradoEm: '2026-06-01T00:00:00Z' },
      { campoAlterado: 'regraPreco', alteradoEm: '2026-03-01T00:00:00Z' },
    ];
    expect(reajusteAnualPendente(historico, '2020-01-01T00:00:00Z', hoje)).toBe(false);
  });
});
