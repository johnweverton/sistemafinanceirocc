// Testes da derivação de TIPO e validação de combinação (PRD §5.1, §8.2).
import { describe, it, expect } from 'vitest';
import { tipoDoMedico, combinacaoClasseValida } from '../src/types/medico';

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
