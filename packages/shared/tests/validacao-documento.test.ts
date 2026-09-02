// Testes do dígito verificador de CPF/CNPJ (achado 2026-09-02, caso Yana Clara PF) — ponto único
// reusado pelo schema Zod (cadastro), por cobrancaMinimaEmissao (guard de emissão) e pelos
// formulários (feedback em tempo real).
import { describe, it, expect } from 'vitest';
import { cpfValido, cnpjValido, documentoValido } from '../src/validacao-documento';

describe('cpfValido', () => {
  it('aceita CPF com dígito verificador correto', () => {
    expect(cpfValido('11144477735')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
  });
  it('rejeita CPF com dígito verificador errado', () => {
    expect(cpfValido('11144477736')).toBe(false);
  });
  it('rejeita CPF com tamanho diferente de 11 dígitos', () => {
    expect(cpfValido('1114447773')).toBe(false);
    expect(cpfValido('111444777355')).toBe(false);
  });
  it('rejeita string com caracteres não numéricos', () => {
    expect(cpfValido('111.444.777-35')).toBe(false);
  });
  it('rejeita sequência de dígitos repetidos (matematicamente "válida" pelo módulo 11, mas nunca é real)', () => {
    expect(cpfValido('00000000000')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
  });
});

describe('cnpjValido', () => {
  it('aceita CNPJ com dígito verificador correto', () => {
    expect(cnpjValido('11222333000181')).toBe(true);
  });
  it('rejeita CNPJ com dígito verificador errado', () => {
    expect(cnpjValido('11222333000182')).toBe(false);
  });
  it('rejeita CNPJ com tamanho diferente de 14 dígitos', () => {
    expect(cnpjValido('1122233300018')).toBe(false);
    expect(cnpjValido('112223330001811')).toBe(false);
  });
  it('rejeita sequência de dígitos repetidos', () => {
    expect(cnpjValido('00000000000000')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
  });
});

describe('documentoValido', () => {
  it('PF delega para cpfValido', () => {
    expect(documentoValido('PF', '11144477735')).toBe(true);
    expect(documentoValido('PF', '11144477736')).toBe(false);
  });
  it('PJ delega para cnpjValido', () => {
    expect(documentoValido('PJ', '11222333000181')).toBe(true);
    expect(documentoValido('PJ', '11222333000182')).toBe(false);
  });
});
