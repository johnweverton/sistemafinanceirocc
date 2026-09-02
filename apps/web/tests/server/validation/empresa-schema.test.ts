// Validação Zod do cadastro de empresa (Story 10.4a) — reaproveita os blocos de médico
// (dadosCobrancaSchema, condicoesCobrancaSchema, regraPrecoSchema); aqui só cobrimos a
// composição (novaEmpresaSchema/atualizarEmpresaSchema), não a validação interna dos blocos
// (já coberta em cobranca-schema.test.ts e medico-schema-preco-proprio.test.ts).
import { describe, it, expect } from 'vitest';
import { novaEmpresaSchema, atualizarEmpresaSchema } from '../../../src/server/validation/empresa-schema';

describe('novaEmpresaSchema', () => {
  it('nome sozinho passa (cobrança/condições/regra de preço são opcionais)', () => {
    const r = novaEmpresaSchema.parse({ nome: 'MEDISA' });
    expect(r.nome).toBe('MEDISA');
    expect(r.cobranca).toBeNull();
    expect(r.regraPreco).toBeNull();
    expect(r.ativo).toBe(true);
  });

  it('nome vazio → rejeita', () => {
    expect(novaEmpresaSchema.safeParse({ nome: '' }).success).toBe(false);
  });

  it('cobrança PJ (CNPJ 14 dígitos) válida passa', () => {
    const r = novaEmpresaSchema.parse({
      nome: 'MEDISA',
      cobranca: {
        pagadorTipo: 'PJ',
        pagadorDocumento: '11222333000181', // dígito verificador válido
        pagadorNome: 'MEDISA Serviços Médicos Ltda',
      },
    });
    expect(r.cobranca?.pagadorDocumento).toBe('11222333000181');
  });

  it('cobrança PJ com CPF (11 dígitos) → rejeita (documento incompatível com o tipo)', () => {
    const r = novaEmpresaSchema.safeParse({
      nome: 'MEDISA',
      cobranca: { pagadorTipo: 'PJ', pagadorDocumento: '12345678901', pagadorNome: 'MEDISA' },
    });
    expect(r.success).toBe(false);
  });

  it('regra de preço por_guia (MEDISA R$6,41/guia) passa', () => {
    const r = novaEmpresaSchema.parse({
      nome: 'MEDISA',
      regraPreco: { forma: 'por_guia', taxa: 6.41 },
    });
    expect(r.regraPreco).toMatchObject({ forma: 'por_guia', taxa: 6.41 });
  });

  it('regra de preço por_guia sem taxa → rejeita', () => {
    const r = novaEmpresaSchema.safeParse({ nome: 'MEDISA', regraPreco: { forma: 'por_guia' } });
    expect(r.success).toBe(false);
  });
});

describe('atualizarEmpresaSchema', () => {
  it('exige motivo', () => {
    const r = atualizarEmpresaSchema.safeParse({ nome: 'MEDISA Ltda' });
    expect(r.success).toBe(false);
  });

  it('update parcial (só ativo) com motivo passa', () => {
    const r = atualizarEmpresaSchema.safeParse({ ativo: false, motivo: 'Empresa encerrou o contrato' });
    expect(r.success).toBe(true);
  });

  it('campo fora da whitelist (strict) → rejeita', () => {
    const r = atualizarEmpresaSchema.safeParse({ nome: 'X', motivo: 'y', campoInvalido: 'z' });
    expect(r.success).toBe(false);
  });
});
