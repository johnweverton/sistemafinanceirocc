// Testes da função extraída aplicarRegraPreco (Story 10.4b) — reaproveitada pelo médico
// individual (Story 10.1, preco_proprio) e pelo agregado de empresa (Story 10.4b).
import { describe, it, expect } from 'vitest';
import type { RegraPreco } from '@cobranca/shared';
import { aplicarRegraPreco } from '../../../src/server/engine/regra-preco';

describe('aplicarRegraPreco — forma por_guia', () => {
  it('90 guias × R$4,00 = R$360,00 (Ezequiel)', () => {
    const regra: RegraPreco = { forma: 'por_guia', base: null, limiar: null, taxa: 4.0, valorFixo: null };
    const r = aplicarRegraPreco(regra, 90);
    expect(r.valor).toBe(360);
    expect(r.alertas).toEqual([]);
  });

  it('sem taxa → alerta, valor 0', () => {
    const regra: RegraPreco = { forma: 'por_guia', base: null, limiar: null, taxa: null, valorFixo: null };
    const r = aplicarRegraPreco(regra, 90);
    expect(r.valor).toBe(0);
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0]).toContain('por guia');
  });
});

describe('aplicarRegraPreco — forma base_excedente', () => {
  it('935,62 + (173-144)×6,50 = 1123,12 (Jansen)', () => {
    const regra: RegraPreco = { forma: 'base_excedente', base: 935.62, limiar: 144, taxa: 6.5, valorFixo: null };
    const r = aplicarRegraPreco(regra, 173);
    expect(r.valor).toBeCloseTo(935.62 + 29 * 6.5, 2);
  });

  it('incompleta → alerta, valor 0', () => {
    const regra: RegraPreco = { forma: 'base_excedente', base: 935.62, limiar: null, taxa: 6.5, valorFixo: null };
    const r = aplicarRegraPreco(regra, 173);
    expect(r.valor).toBe(0);
    expect(r.alertas[0]).toContain('base + excedente');
  });
});

describe('aplicarRegraPreco — forma fixo', () => {
  it('valor fixo independe de guias', () => {
    const regra: RegraPreco = { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 591.22 };
    expect(aplicarRegraPreco(regra, 10).valor).toBe(591.22);
    expect(aplicarRegraPreco(regra, 500).valor).toBe(591.22);
  });

  it('sem valorFixo → alerta, valor 0', () => {
    const regra: RegraPreco = { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: null };
    const r = aplicarRegraPreco(regra, 10);
    expect(r.valor).toBe(0);
    expect(r.alertas[0]).toContain('fixo');
  });
});

describe('aplicarRegraPreco — regra ausente', () => {
  it('null → alerta, valor 0', () => {
    const r = aplicarRegraPreco(null, 100);
    expect(r.valor).toBe(0);
    expect(r.alertas[0]).toContain('sem regra configurada');
  });
});
