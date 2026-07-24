// Validação Zod do cadastro de cliente contábil (Story 11.1) — reaproveita os blocos de médico
// (dadosCobrancaSchema, condicoesCobrancaSchema, regraPrecoSchema); aqui cobrimos a composição
// (novoClienteContabilidadeSchema/atualizarClienteContabilidadeSchema) e a coerência da forma
// faixa_faturamento + adicional semestral.
import { describe, it, expect } from 'vitest';
import {
  novoClienteContabilidadeSchema,
  atualizarClienteContabilidadeSchema,
  lancarFaturamentoSchema,
} from '../../../src/server/validation/cliente-contabilidade-schema';

describe('novoClienteContabilidadeSchema', () => {
  it('nome + regime + modo passam (demais campos são opcionais)', () => {
    const r = novoClienteContabilidadeSchema.parse({
      nome: 'Padaria Bom Pão Ltda',
      regimeTributario: 'simples_nacional',
      modoCobranca: 'faixa_faturamento',
    });
    expect(r.nome).toBe('Padaria Bom Pão Ltda');
    expect(r.cobranca).toBeNull();
    expect(r.regraPreco).toBeNull();
    expect(r.adicionalAtivo).toBe(false);
    expect(r.ativo).toBe(true);
  });

  it('nome vazio → rejeita', () => {
    expect(
      novoClienteContabilidadeSchema.safeParse({
        nome: '',
        regimeTributario: 'simples_nacional',
        modoCobranca: 'fixo',
      }).success,
    ).toBe(false);
  });

  it('regime/modo fora do enum → rejeita', () => {
    expect(
      novoClienteContabilidadeSchema.safeParse({
        nome: 'X',
        regimeTributario: 'invalido',
        modoCobranca: 'fixo',
      }).success,
    ).toBe(false);
  });

  it('regra faixa_faturamento completa (limiar + 2 valores) passa', () => {
    const r = novoClienteContabilidadeSchema.parse({
      nome: 'Padaria Bom Pão Ltda',
      regimeTributario: 'simples_nacional',
      modoCobranca: 'faixa_faturamento',
      regraPreco: { forma: 'faixa_faturamento', limiar: 5000, valorAbaixoLimiar: 250, valorAcimaLimiar: 480.56 },
    });
    expect(r.regraPreco).toMatchObject({ limiar: 5000, valorAbaixoLimiar: 250, valorAcimaLimiar: 480.56 });
  });

  it('regra faixa_faturamento sem valorAcimaLimiar → rejeita', () => {
    const r = novoClienteContabilidadeSchema.safeParse({
      nome: 'X',
      regimeTributario: 'simples_nacional',
      modoCobranca: 'faixa_faturamento',
      regraPreco: { forma: 'faixa_faturamento', limiar: 5000, valorAbaixoLimiar: 250 },
    });
    expect(r.success).toBe(false);
  });

  it('regra fixo (Lucro Presumido) com valorFixo passa', () => {
    const r = novoClienteContabilidadeSchema.parse({
      nome: 'Clínica X',
      regimeTributario: 'lucro_presumido',
      modoCobranca: 'fixo',
      regraPreco: { forma: 'fixo', valorFixo: 1200 },
    });
    expect(r.regraPreco).toMatchObject({ forma: 'fixo', valorFixo: 1200 });
  });

  it('adicional ativo sem valor/intervalo/competência → rejeita', () => {
    const r = novoClienteContabilidadeSchema.safeParse({
      nome: 'Vital Soluções',
      regimeTributario: 'lucro_presumido',
      modoCobranca: 'fixo',
      adicionalAtivo: true,
    });
    expect(r.success).toBe(false);
  });

  it('adicional ativo completo (valor + intervalo + competência) passa', () => {
    const r = novoClienteContabilidadeSchema.parse({
      nome: 'Vital Soluções',
      regimeTributario: 'lucro_presumido',
      modoCobranca: 'fixo',
      regraPreco: { forma: 'fixo', valorFixo: 1200 },
      adicionalAtivo: true,
      adicionalValor: 15000,
      adicionalIntervaloMeses: 6,
      adicionalCompetenciaBase: '2026-01',
    });
    expect(r.adicionalValor).toBe(15000);
  });

  it('competência base fora do formato YYYY-MM → rejeita', () => {
    const r = novoClienteContabilidadeSchema.safeParse({
      nome: 'Vital Soluções',
      regimeTributario: 'lucro_presumido',
      modoCobranca: 'fixo',
      adicionalAtivo: true,
      adicionalValor: 15000,
      adicionalIntervaloMeses: 6,
      adicionalCompetenciaBase: '01-2026',
    });
    expect(r.success).toBe(false);
  });
});

describe('atualizarClienteContabilidadeSchema', () => {
  it('exige motivo', () => {
    const r = atualizarClienteContabilidadeSchema.safeParse({ nome: 'Padaria Bom Pão Ltda' });
    expect(r.success).toBe(false);
  });

  it('update parcial (só ativo) com motivo passa', () => {
    const r = atualizarClienteContabilidadeSchema.safeParse({ ativo: false, motivo: 'Cliente encerrou contrato' });
    expect(r.success).toBe(true);
  });

  it('campo fora da whitelist (strict) → rejeita', () => {
    const r = atualizarClienteContabilidadeSchema.safeParse({ nome: 'X', motivo: 'y', campoInvalido: 'z' });
    expect(r.success).toBe(false);
  });
});

describe('lancarFaturamentoSchema (Story 11.2)', () => {
  it('competência YYYY-MM + faturamento válido passa', () => {
    const r = lancarFaturamentoSchema.parse({ competencia: '2026-07', faturamento: 4500 });
    expect(r.faturamento).toBe(4500);
  });

  it('competência fora do formato → rejeita', () => {
    expect(lancarFaturamentoSchema.safeParse({ competencia: '07-2026', faturamento: 4500 }).success).toBe(false);
  });

  it('faturamento negativo → rejeita', () => {
    expect(lancarFaturamentoSchema.safeParse({ competencia: '2026-07', faturamento: -1 }).success).toBe(false);
  });

  it('faturamento zero é válido (mês sem movimento)', () => {
    expect(lancarFaturamentoSchema.safeParse({ competencia: '2026-07', faturamento: 0 }).success).toBe(true);
  });
});
