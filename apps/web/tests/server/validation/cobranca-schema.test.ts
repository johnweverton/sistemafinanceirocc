// Testes do schema Zod de dados de cobrança (Story 3.1).
import { describe, it, expect } from 'vitest';
import {
  dadosCobrancaSchema,
  novoMedicoSchema,
} from '@/server/validation/medico-schema';

const cobrancaPF = {
  pagadorTipo: 'PF',
  pagadorDocumento: '12345678901',
  pagadorNome: 'Dr. Fulano',
  email: 'fulano@exemplo.com',
  cep: '60000000',
  logradouro: 'Rua A',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Fortaleza',
  uf: 'CE',
};

describe('dadosCobrancaSchema', () => {
  it('aceita PF com documento de 11 dígitos', () => {
    expect(dadosCobrancaSchema.safeParse(cobrancaPF).success).toBe(true);
  });
  it('aceita PJ com documento de 14 dígitos', () => {
    const pj = { ...cobrancaPF, pagadorTipo: 'PJ', pagadorDocumento: '12345678000199' };
    expect(dadosCobrancaSchema.safeParse(pj).success).toBe(true);
  });
  it('rejeita PF com 14 dígitos (incompatível com o tipo)', () => {
    const bad = { ...cobrancaPF, pagadorDocumento: '12345678000199' };
    expect(dadosCobrancaSchema.safeParse(bad).success).toBe(false);
  });
  it('rejeita CEP fora de 8 dígitos', () => {
    expect(dadosCobrancaSchema.safeParse({ ...cobrancaPF, cep: '6000' }).success).toBe(false);
  });
  it('rejeita UF inválida', () => {
    expect(dadosCobrancaSchema.safeParse({ ...cobrancaPF, uf: 'XX' }).success).toBe(false);
  });
  it('rejeita e-mail inválido', () => {
    expect(dadosCobrancaSchema.safeParse({ ...cobrancaPF, email: 'nao-email' }).success).toBe(false);
  });
  it('complemento é opcional', () => {
    const { complemento, ...semComplemento } = { ...cobrancaPF, complemento: 'x' };
    void complemento;
    expect(dadosCobrancaSchema.safeParse(semComplemento).success).toBe(true);
  });
});

describe('dadosCobrancaSchema — mínimo pra emitir (Épico 6: só documento+nome obrigatórios)', () => {
  const minima = {
    pagadorTipo: 'PF',
    pagadorDocumento: '12345678901',
    pagadorNome: 'Dr. Fulano',
  };
  it('aceita bloco só com documento+nome (sem email/endereço)', () => {
    const res = dadosCobrancaSchema.safeParse(minima);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.email).toBe('');
      expect(res.data.cep).toBe('');
      expect(res.data.whatsapp).toBe(null);
    }
  });
  it('e-mail vazio é aceito (não é mais obrigatório)', () => {
    expect(dadosCobrancaSchema.safeParse({ ...minima, email: '' }).success).toBe(true);
  });
  it('e-mail inválido (não vazio) ainda é rejeitado', () => {
    expect(dadosCobrancaSchema.safeParse({ ...minima, email: 'nao-email' }).success).toBe(false);
  });
  it('UF vazia é aceita, mas UF inválida (não vazia) ainda é rejeitada', () => {
    expect(dadosCobrancaSchema.safeParse({ ...minima, uf: '' }).success).toBe(true);
    expect(dadosCobrancaSchema.safeParse({ ...minima, uf: 'XX' }).success).toBe(false);
  });
  it('whatsapp é validado e preservado', () => {
    const res = dadosCobrancaSchema.safeParse({ ...minima, whatsapp: '5511999999999' });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.whatsapp).toBe('5511999999999');
  });
  it('documento ou nome ausentes ainda são rejeitados', () => {
    expect(dadosCobrancaSchema.safeParse({ pagadorTipo: 'PF', pagadorNome: 'Dr. Fulano' }).success).toBe(false);
    expect(dadosCobrancaSchema.safeParse({ pagadorTipo: 'PF', pagadorDocumento: '12345678901' }).success).toBe(false);
  });
});

describe('novoMedicoSchema com cobrança', () => {
  const medicoBase = {
    cpf: '98765432100',
    nome: 'Dra. Ciclana',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
  };
  it('médico sem cobrança continua válido (bloco opcional)', () => {
    expect(novoMedicoSchema.safeParse(medicoBase).success).toBe(true);
  });
  it('médico com cobrança válida é aceito', () => {
    expect(novoMedicoSchema.safeParse({ ...medicoBase, cobranca: cobrancaPF }).success).toBe(true);
  });
  it('médico com cobrança inválida é rejeitado', () => {
    const res = novoMedicoSchema.safeParse({ ...medicoBase, cobranca: { ...cobrancaPF, uf: 'ZZ' } });
    expect(res.success).toBe(false);
  });
});
