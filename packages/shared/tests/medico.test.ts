// Testes da derivação de TIPO e validação de combinação (PRD §5.1, §8.2).
import { describe, it, expect } from 'vitest';
import { tipoDoMedico, combinacaoClasseValida, cobrancaCompleta } from '../src/types/medico';
import type { DadosCobranca } from '../src/types/medico';

describe('tipoDoMedico (PRD §5.1)', () => {
  it('TIPO 1: não credenciado sem outros', () => {
    expect(tipoDoMedico({ statusHapvida: 'nao_credenciado', fazOutrosHospitais: false })).toBe(1);
  });
  it('TIPO 2: credenciado sem outros', () => {
    expect(tipoDoMedico({ statusHapvida: 'credenciado', fazOutrosHospitais: false })).toBe(2);
  });
  it('TIPO 3: somente outros hospitais (nenhum Hapvida)', () => {
    expect(tipoDoMedico({ statusHapvida: 'nenhum', fazOutrosHospitais: true })).toBe(3);
  });
  it('TIPO 4: credenciado + outros', () => {
    expect(tipoDoMedico({ statusHapvida: 'credenciado', fazOutrosHospitais: true })).toBe(4);
  });
  it('TIPO 5: não credenciado + outros', () => {
    expect(tipoDoMedico({ statusHapvida: 'nao_credenciado', fazOutrosHospitais: true })).toBe(5);
  });
  it('combinação inválida (nenhum + sem outros) → lança', () => {
    expect(() => tipoDoMedico({ statusHapvida: 'nenhum', fazOutrosHospitais: false })).toThrow();
  });
});

describe('combinacaoClasseValida (PRD §8.2)', () => {
  it('nenhum + sem outros → inválida', () => {
    expect(combinacaoClasseValida({ statusHapvida: 'nenhum', fazOutrosHospitais: false })).toBe(false);
  });
  it('nenhum + outros → válida', () => {
    expect(combinacaoClasseValida({ statusHapvida: 'nenhum', fazOutrosHospitais: true })).toBe(true);
  });
});

describe('cobrancaCompleta (Fase 3)', () => {
  const basePF: DadosCobranca = {
    pagadorTipo: 'PF',
    pagadorDocumento: '12345678901', // 11 dígitos
    pagadorNome: 'Dr. Fulano',
    email: 'fulano@exemplo.com',
    cep: '60000000',
    logradouro: 'Rua A',
    numero: '100',
    complemento: null,
    bairro: 'Centro',
    cidade: 'Fortaleza',
    uf: 'CE',
  };
  const basePJ: DadosCobranca = { ...basePF, pagadorTipo: 'PJ', pagadorDocumento: '12345678000199' }; // 14

  it('bloco ausente (null) → incompleto', () => {
    expect(cobrancaCompleta({ cobranca: null })).toBe(false);
    expect(cobrancaCompleta({ cobranca: undefined })).toBe(false);
  });
  it('PF completo (11 dígitos) → completo', () => {
    expect(cobrancaCompleta({ cobranca: basePF })).toBe(true);
  });
  it('PJ completo (14 dígitos) → completo', () => {
    expect(cobrancaCompleta({ cobranca: basePJ })).toBe(true);
  });
  it('complemento ausente não invalida', () => {
    expect(cobrancaCompleta({ cobranca: { ...basePF, complemento: null } })).toBe(true);
  });
  it('documento com tamanho errado para o tipo → incompleto', () => {
    expect(cobrancaCompleta({ cobranca: { ...basePF, pagadorDocumento: '123' } })).toBe(false);
    expect(cobrancaCompleta({ cobranca: { ...basePJ, pagadorDocumento: '12345678901' } })).toBe(false);
  });
  it('campo obrigatório vazio → incompleto', () => {
    expect(cobrancaCompleta({ cobranca: { ...basePF, email: '' } })).toBe(false);
    expect(cobrancaCompleta({ cobranca: { ...basePF, cidade: '   ' } })).toBe(false);
  });
});
