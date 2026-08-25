// Story 12.2 (AC 1, 5) — utilitários únicos de formatação.
// Antes desta story `brl()` era copiado em 17 arquivos e `normalizarBusca()` em 6; os pontos que
// esqueciam de copiar caíam no `R$ ${v.toFixed(2)}` cru e mostravam "R$ 1480.56" na tela. Estes
// testes travam o formato pt-BR e a normalização de busca num lugar só.
import { describe, it, expect } from 'vitest';
import { brl, normalizarBusca } from '../../src/lib/formato';

/** `toLocaleString` usa espaço não quebrável entre "R$" e o número — compare sem se importar. */
function semNbsp(s: string): string {
  return s.replace(/\s/g, ' ');
}

describe('brl', () => {
  it('formata milhar com ponto e centavo com vírgula (o caso que a story existe para matar)', () => {
    expect(semNbsp(brl(1480.56))).toBe('R$ 1.480,56');
    // O jeito antigo, para deixar explícito o que mudou:
    expect(`R$ ${(1480.56).toFixed(2)}`).toBe('R$ 1480.56');
  });

  it('zero', () => {
    expect(semNbsp(brl(0))).toBe('R$ 0,00');
  });

  it('negativo mantém o sinal antes do símbolo', () => {
    expect(semNbsp(brl(-150.32))).toBe('-R$ 150,32');
  });

  it('sempre 2 casas decimais, inclusive em valor inteiro', () => {
    expect(semNbsp(brl(250))).toBe('R$ 250,00');
  });

  it('arredonda a terceira casa (meio centavo sobe)', () => {
    expect(semNbsp(brl(0.005))).toBe('R$ 0,01');
  });

  it('milhão usa separador em todos os grupos', () => {
    expect(semNbsp(brl(1234567.89))).toBe('R$ 1.234.567,89');
  });

  it('null/undefined valem zero — comportamento das cópias que liam valor nulável do banco', () => {
    expect(semNbsp(brl(null))).toBe('R$ 0,00');
    expect(semNbsp(brl(undefined))).toBe('R$ 0,00');
  });
});

describe('normalizarBusca', () => {
  it('remove acento e baixa a caixa', () => {
    expect(normalizarBusca('Dr. José Ângelo')).toBe('dr. jose angelo');
  });

  it('cobre os diacríticos do português (ç, ~, ^, `, ´, ¨)', () => {
    expect(normalizarBusca('Conceição')).toBe('conceicao');
    expect(normalizarBusca('ÁÀÂÃÄ ÉÊ Í ÓÔÕ ÚÜ Ç')).toBe('aaaaa ee i ooo uu c');
  });

  it('texto sem acento passa intacto (só a caixa muda)', () => {
    expect(normalizarBusca('PADARIA BOM PAO LTDA')).toBe('padaria bom pao ltda');
  });

  it('não faz trim: o espaço digitado no meio do termo é significativo para o includes()', () => {
    expect(normalizarBusca('  João  ')).toBe('  joao  ');
  });

  it('string vazia', () => {
    expect(normalizarBusca('')).toBe('');
  });

  it('é o que permite "jose" achar "José" num includes()', () => {
    expect(normalizarBusca('Dr. José').includes(normalizarBusca('jose'))).toBe(true);
  });
});
