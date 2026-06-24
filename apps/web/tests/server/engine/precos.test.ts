// Testes da tabela de preço (PRD §5.1) — faixas, excedente e o caso FORA DA TABELA (§11).
import { describe, it, expect } from 'vitest';
import { valorDaFaixa, classesDoMedico, TABELA_PRECO_PADRAO } from '../../../src/server/engine';

describe('valorDaFaixa — HAPVIDA_CRED', () => {
  const t = TABELA_PRECO_PADRAO.HAPVIDA_CRED;
  it('30 guias → R$263,59 (primeira faixa)', () => {
    expect(valorDaFaixa(t, 30).valor).toBe(263.59);
  });
  it('17 guias → cai na faixa até 30', () => {
    const r = valorDaFaixa(t, 17);
    expect(r.valor).toBe(263.59);
    expect(r.faixa).toBe('até 30 guias');
  });
  it('180 guias → R$950,89 (última faixa)', () => {
    expect(valorDaFaixa(t, 180).valor).toBe(950.89);
  });
  it('200 guias → excedente por guia: 950,89 + 20×6 = 1070,89', () => {
    expect(valorDaFaixa(t, 200).valor).toBeCloseTo(950.89 + 20 * 6, 2);
  });
});

describe('valorDaFaixa — OUTROS_HOSPITAIS acima de 80 (PRD §11)', () => {
  const t = TABELA_PRECO_PADRAO.OUTROS_HOSPITAIS;
  it('80 guias → R$367,36 (último teto definido)', () => {
    expect(valorDaFaixa(t, 80).valor).toBe(367.36);
  });
  it('81 guias → FORA DA TABELA, valor null (nunca extrapola)', () => {
    const r = valorDaFaixa(t, 81);
    expect(r.valor).toBeNull();
    expect(r.faixa).toContain('FORA DA TABELA');
  });
});

describe('valorDaFaixa — IMOBILIZACOES (excedente fixo)', () => {
  const t = TABELA_PRECO_PADRAO.IMOBILIZACOES;
  it('150 guias → R$186,10', () => {
    expect(valorDaFaixa(t, 150).valor).toBe(186.1);
  });
  it('151 guias → valor fixo R$387,78', () => {
    expect(valorDaFaixa(t, 151).valor).toBe(387.78);
  });
});

describe('classesDoMedico (porte 1:1 do Python — ver TODO §11)', () => {
  it('credenciado sem outros → [HAPVIDA_CRED]', () => {
    expect(classesDoMedico({ statusHapvida: 'credenciado', fazOutrosHospitais: false, fazImobilizacoes: false })).toEqual([
      'HAPVIDA_CRED',
    ]);
  });
  it('não credenciado sem outros → [HAPVIDA_NAO_CRED]', () => {
    expect(classesDoMedico({ statusHapvida: 'nao_credenciado', fazOutrosHospitais: false, fazImobilizacoes: false })).toEqual([
      'HAPVIDA_NAO_CRED',
    ]);
  });
  it('credenciado + outros + imobilizações → 3 classes', () => {
    expect(
      classesDoMedico({ statusHapvida: 'credenciado', fazOutrosHospitais: true, fazImobilizacoes: true }),
    ).toEqual(['HAPVIDA_CRED', 'OUTROS_HOSPITAIS', 'IMOBILIZACOES']);
  });
});
