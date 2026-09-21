// Testes da derivação de TIPO e validação de combinação (PRD §5.1, §8.2).
import { describe, it, expect } from 'vitest';
import { tipoDoMedico, combinacaoClasseValida, cobrancaCompleta, cobrancaMinimaEmissao, cadastroCompleto } from '../src/types/medico';
import type { DadosCobranca, Medico } from '../src/types/medico';

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

describe('cobrancaMinimaEmissao (Épico 6 — mínimo pra emitir: documento + nome)', () => {
  const minimaPF: DadosCobranca = {
    pagadorTipo: 'PF',
    pagadorDocumento: '11144477735', // 11 dígitos, dígito verificador válido
    pagadorNome: 'Dr. Fulano',
    email: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: null,
    bairro: '',
    cidade: '',
    uf: '',
  };
  const minimaPJ: DadosCobranca = { ...minimaPF, pagadorTipo: 'PJ', pagadorDocumento: '11222333000181' }; // 14, dígito verificador válido

  it('bloco ausente (null) → não pode emitir', () => {
    expect(cobrancaMinimaEmissao({ cobranca: null })).toBe(false);
    expect(cobrancaMinimaEmissao({ cobranca: undefined })).toBe(false);
  });
  it('PF só com documento+nome (sem email/endereço) → pode emitir', () => {
    expect(cobrancaMinimaEmissao({ cobranca: minimaPF })).toBe(true);
  });
  it('PJ só com documento+nome (sem email/endereço) → pode emitir', () => {
    expect(cobrancaMinimaEmissao({ cobranca: minimaPJ })).toBe(true);
  });
  it('documento com tamanho errado para o tipo → não pode emitir', () => {
    expect(cobrancaMinimaEmissao({ cobranca: { ...minimaPF, pagadorDocumento: '123' } })).toBe(false);
    expect(cobrancaMinimaEmissao({ cobranca: { ...minimaPJ, pagadorDocumento: '12345678901' } })).toBe(false);
  });
  it('nome vazio → não pode emitir', () => {
    expect(cobrancaMinimaEmissao({ cobranca: { ...minimaPF, pagadorNome: '   ' } })).toBe(false);
  });
});

describe('cobrancaCompleta (Épico 6; feedback do dono 2026-08-19 — mínimo + e-mail OU whatsapp)', () => {
  const basePF: DadosCobranca = {
    pagadorTipo: 'PF',
    pagadorDocumento: '11144477735', // 11 dígitos, dígito verificador válido
    pagadorNome: 'Dr. Fulano',
    email: 'fulano@exemplo.com',
    whatsapp: '5511999999999',
    cep: '60000000',
    logradouro: 'Rua A',
    numero: '100',
    complemento: null,
    bairro: 'Centro',
    cidade: 'Fortaleza',
    uf: 'CE',
  };
  const basePJ: DadosCobranca = { ...basePF, pagadorTipo: 'PJ', pagadorDocumento: '11222333000181' }; // 14, dígito verificador válido

  it('bloco ausente (null) → incompleto', () => {
    expect(cobrancaCompleta({ cobranca: null })).toBe(false);
    expect(cobrancaCompleta({ cobranca: undefined })).toBe(false);
  });
  it('PF completo (11 dígitos, com email e whatsapp) → completo', () => {
    expect(cobrancaCompleta({ cobranca: basePF })).toBe(true);
  });
  it('PJ completo (14 dígitos, com email e whatsapp) → completo', () => {
    expect(cobrancaCompleta({ cobranca: basePJ })).toBe(true);
  });
  it('endereço ausente não invalida mais (Épico 6: endereço não é exigido)', () => {
    expect(cobrancaCompleta({ cobranca: { ...basePF, cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '' } })).toBe(true);
  });
  it('documento com tamanho errado para o tipo → incompleto', () => {
    expect(cobrancaCompleta({ cobranca: { ...basePF, pagadorDocumento: '123' } })).toBe(false);
    expect(cobrancaCompleta({ cobranca: { ...basePJ, pagadorDocumento: '12345678901' } })).toBe(false);
  });
  it('só com e-mail (sem whatsapp) → completo', () => {
    expect(cobrancaCompleta({ cobranca: { ...basePF, whatsapp: null } })).toBe(true);
    expect(cobrancaCompleta({ cobranca: { ...basePF, whatsapp: '' } })).toBe(true);
  });
  it('só com whatsapp (sem e-mail) → completo', () => {
    expect(cobrancaCompleta({ cobranca: { ...basePF, email: '' } })).toBe(true);
  });
  it('sem e-mail e sem whatsapp → incompleto', () => {
    expect(cobrancaCompleta({ cobranca: { ...basePF, email: '', whatsapp: null } })).toBe(false);
  });
});

describe('cadastroCompleto (feedback do dono, 2026-08-19 — gate do status "Ativo" em MedicosManager)', () => {
  const cobrancaOk: DadosCobranca = {
    pagadorTipo: 'PF',
    pagadorDocumento: '11144477735',
    pagadorNome: 'Dr. Fulano',
    email: '',
    whatsapp: '5511999999999',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: null,
    bairro: '',
    cidade: '',
    uf: '',
  };
  const base: Pick<Medico, 'nome' | 'especialidade' | 'statusHapvida' | 'contaEmissora' | 'modoCobranca' | 'cobranca'> = {
    nome: 'Dr. Fulano',
    especialidade: 'Cardiologia',
    statusHapvida: 'credenciado',
    contaEmissora: 'mc',
    modoCobranca: 'faixa_guias',
    cobranca: cobrancaOk,
  };

  it('todos os campos preenchidos (contato só por whatsapp) → completo', () => {
    expect(cadastroCompleto(base)).toBe(true);
  });
  it('sem especialidade → incompleto', () => {
    expect(cadastroCompleto({ ...base, especialidade: null })).toBe(false);
  });
  it('sem nome → incompleto', () => {
    expect(cadastroCompleto({ ...base, nome: '' })).toBe(false);
  });
  it('sem bloco de cobrança → incompleto', () => {
    expect(cadastroCompleto({ ...base, cobranca: null })).toBe(false);
  });
  it('cpf do médico e externalId NÃO entram na regra (avisos à parte)', () => {
    expect(cadastroCompleto(base)).toBe(true);
  });
});
