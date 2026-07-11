// Bateria do motor de conciliação (Story 8.2, AC 1/6) — todos os ramos do matching.
// Princípio testado à exaustão: ambiguidade NUNCA auto-concilia (falso positivo em
// conciliação financeira é inaceitável).
import { describe, it, expect } from 'vitest';
import {
  conciliar,
  resumirTransicoes,
  type TransacaoParaConciliacao,
  type BoletoParaConciliacao,
} from '@/server/engine/conciliacao';

function credito(
  id: string,
  overrides: Partial<TransacaoParaConciliacao> = {},
): TransacaoParaConciliacao {
  return {
    transacaoId: id,
    tipo: 'CREDIT',
    transactionType: 'PAYMENT',
    valor: 1500,
    contraparteDocumento: '12345678901',
    dataTransacao: '2026-07-08T10:00:00Z',
    statusConciliacao: 'sem_match',
    ...overrides,
  };
}

function boleto(id: string, overrides: Partial<BoletoParaConciliacao> = {}): BoletoParaConciliacao {
  return {
    boletoId: id,
    valorPago: 1500,
    pagoEm: '2026-07-08T09:00:00Z',
    pagadorDocumento: '12345678901',
    ...overrides,
  };
}

describe('conciliar — camada 1 (auto)', () => {
  it('valor + documento + janela, par único → conciliado_auto', () => {
    const r = conciliar([credito('t1')], [boleto('b1')]);
    expect(r).toEqual([{ transacaoId: 't1', status: 'conciliado_auto', boletoId: 'b1' }]);
  });

  it('data até 3 dias antes/depois da baixa ainda é auto; além, não', () => {
    // 3 dias exatos depois da baixa: dentro da janela.
    const dentro = conciliar(
      [credito('t1', { dataTransacao: '2026-07-11T09:00:00Z' })],
      [boleto('b1', { pagoEm: '2026-07-08T09:00:00Z' })],
    );
    expect(dentro[0]?.status).toBe('conciliado_auto');

    // 3 dias + 1 hora: fora.
    const fora = conciliar(
      [credito('t2', { dataTransacao: '2026-07-11T10:00:01Z' })],
      [boleto('b1', { pagoEm: '2026-07-08T09:00:00Z' })],
    );
    expect(fora[0]?.status).toBe('sem_match');
  });

  it('valor compara em CENTAVOS (1500.004 ≈ 1500.00; 1500.01 ≠)', () => {
    const igual = conciliar([credito('t1', { valor: 1500.004 })], [boleto('b1', { valorPago: 1500 })]);
    expect(igual[0]?.status).toBe('conciliado_auto');

    const diferente = conciliar([credito('t2', { valor: 1500.01 })], [boleto('b1')]);
    expect(diferente[0]?.status).toBe('sem_match');
  });

  it('2 candidatos de camada 1 para a MESMA transação → sugerido sem candidato (ambiguidade)', () => {
    const r = conciliar([credito('t1')], [boleto('b1'), boleto('b2')]);
    expect(r).toEqual([{ transacaoId: 't1', status: 'sugerido', boletoId: null }]);
  });

  it('1 boleto disputado por 2 transações de camada 1 → NENHUMA auto-concilia (ambos sugerido)', () => {
    const r = conciliar(
      [credito('t1'), credito('t2', { dataTransacao: '2026-07-09T10:00:00Z' })],
      [boleto('b1')],
    );
    expect(r.every((x) => x.status === 'sugerido')).toBe(true);
    // O candidato único fica registrado nos dois — o operador decide qual é o verdadeiro.
    expect(r.map((x) => x.boletoId)).toEqual(['b1', 'b1']);
  });

  it('2 transações × 2 boletos com documentos DISTINTOS → dois autos independentes', () => {
    const r = conciliar(
      [
        credito('t1', { contraparteDocumento: '11111111111' }),
        credito('t2', { contraparteDocumento: '22222222222' }),
      ],
      [
        boleto('b1', { pagadorDocumento: '11111111111' }),
        boleto('b2', { pagadorDocumento: '22222222222' }),
      ],
    );
    expect(r).toEqual([
      { transacaoId: 't1', status: 'conciliado_auto', boletoId: 'b1' },
      { transacaoId: 't2', status: 'conciliado_auto', boletoId: 'b2' },
    ]);
  });
});

describe('conciliar — camada 2 (sugerido)', () => {
  it('valor + janela sem documento na transação → sugerido com candidato', () => {
    const r = conciliar([credito('t1', { contraparteDocumento: null })], [boleto('b1')]);
    expect(r).toEqual([{ transacaoId: 't1', status: 'sugerido', boletoId: 'b1' }]);
  });

  it('documento DIVERGENTE (pagamento por terceiro) → sugerido, nunca auto', () => {
    const r = conciliar([credito('t1', { contraparteDocumento: '99999999999' })], [boleto('b1')]);
    expect(r).toEqual([{ transacaoId: 't1', status: 'sugerido', boletoId: 'b1' }]);
  });

  it('2 candidatos de camada 2 → sugerido sem candidato', () => {
    const r = conciliar(
      [credito('t1', { contraparteDocumento: null })],
      [boleto('b1'), boleto('b2')],
    );
    expect(r).toEqual([{ transacaoId: 't1', status: 'sugerido', boletoId: null }]);
  });

  it('boleto sem documento do pagador cai na camada 2 (nunca auto)', () => {
    const r = conciliar([credito('t1')], [boleto('b1', { pagadorDocumento: null })]);
    expect(r[0]?.status).toBe('sugerido');
  });
});

describe('conciliar — elegibilidade e 1↔1', () => {
  it('débitos e FEE nunca entram no matching', () => {
    const r = conciliar(
      [
        credito('t1', { tipo: 'DEBIT' }),
        credito('t2', { transactionType: 'FEE' }),
        credito('t3'),
      ],
      [boleto('b1')],
    );
    // Só t3 é resolvida; débito e tarifa nem aparecem nas transições.
    expect(r).toEqual([{ transacaoId: 't3', status: 'conciliado_auto', boletoId: 'b1' }]);
  });

  it('estados manuais (conciliado_*/ignorado) não são recalculados', () => {
    const r = conciliar(
      [
        credito('t1', { statusConciliacao: 'conciliado_manual' }),
        credito('t2', { statusConciliacao: 'ignorado' }),
        credito('t3', { statusConciliacao: 'sugerido' }),
      ],
      [boleto('b1')],
    );
    // Apenas o 'sugerido' é recalculável (AC 5).
    expect(r).toEqual([{ transacaoId: 't3', status: 'conciliado_auto', boletoId: 'b1' }]);
  });

  it('boleto sem baixa completa (valorPago/pagoEm null) não é conciliável', () => {
    const r = conciliar(
      [credito('t1')],
      [boleto('b1', { valorPago: null }), boleto('b2', { pagoEm: null })],
    );
    expect(r).toEqual([{ transacaoId: 't1', status: 'sem_match', boletoId: null }]);
  });

  it('boleto consumido por um auto não sobra para a próxima transação (1↔1)', () => {
    // t1 (doc bate) consome b1; t2 (doc divergente, camada 2) fica sem candidato.
    const r = conciliar(
      [
        credito('t1', { dataTransacao: '2026-07-08T10:00:00Z' }),
        credito('t2', {
          dataTransacao: '2026-07-09T10:00:00Z',
          contraparteDocumento: '99999999999',
        }),
      ],
      [boleto('b1')],
    );
    expect(r).toEqual([
      { transacaoId: 't1', status: 'conciliado_auto', boletoId: 'b1' },
      { transacaoId: 't2', status: 'sem_match', boletoId: null },
    ]);
  });

  it('determinístico: ordem dos arrays de entrada não muda o resultado', () => {
    const ts = [
      credito('t2', { dataTransacao: '2026-07-09T10:00:00Z', contraparteDocumento: null }),
      credito('t1'),
    ];
    const bs = [boleto('b2', { pagadorDocumento: '99999999999' }), boleto('b1')];
    const a = conciliar(ts, bs);
    const b = conciliar([...ts].reverse(), [...bs].reverse());
    expect(a).toEqual(b);
  });

  it('sem boletos → todos sem_match; sem transações → vazio', () => {
    expect(conciliar([credito('t1')], [])).toEqual([
      { transacaoId: 't1', status: 'sem_match', boletoId: null },
    ]);
    expect(conciliar([], [boleto('b1')])).toEqual([]);
  });
});

describe('resumirTransicoes', () => {
  it('conta por resultado', () => {
    const resumo = resumirTransicoes([
      { transacaoId: 't1', status: 'conciliado_auto', boletoId: 'b1' },
      { transacaoId: 't2', status: 'sugerido', boletoId: null },
      { transacaoId: 't3', status: 'sugerido', boletoId: 'b2' },
      { transacaoId: 't4', status: 'sem_match', boletoId: null },
    ]);
    expect(resumo).toEqual({ autoConciliadas: 1, sugeridas: 2, semMatch: 1 });
  });
});
