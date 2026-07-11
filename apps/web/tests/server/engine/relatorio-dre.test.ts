// Bateria do motor de relatório DRE (Story 9.2, AC 7) — expansão de recorrência (D4) e
// cálculo do resultado líquido.
import { describe, it, expect } from 'vitest';
import {
  gerarRelatorio,
  type TransacaoParaRelatorio,
  type LancamentoParaRelatorio,
  type CategoriaParaRelatorio,
} from '@/server/engine/relatorio-dre';

const CATEGORIAS: CategoriaParaRelatorio[] = [
  { id: 'receita', grupo: 'receita' },
  { id: 'tarifa', grupo: 'deducao_receita' },
  { id: 'aluguel', grupo: 'despesa_operacional' },
  { id: 'juros', grupo: 'despesa_financeira' },
];

function transacao(overrides: Partial<TransacaoParaRelatorio> = {}): TransacaoParaRelatorio {
  return { contaEmissora: 'mc', categoriaId: 'receita', valor: 1000, ...overrides };
}

function avulso(overrides: Partial<LancamentoParaRelatorio> = {}): LancamentoParaRelatorio {
  return {
    contaEmissora: 'mc',
    categoriaId: 'aluguel',
    valor: 500,
    tipoLancamento: 'avulso',
    data: '2026-07-10',
    diaDoMes: null,
    dataInicio: null,
    dataFim: null,
    ...overrides,
  };
}

function recorrente(overrides: Partial<LancamentoParaRelatorio> = {}): LancamentoParaRelatorio {
  return {
    contaEmissora: 'mc',
    categoriaId: 'aluguel',
    valor: 500,
    tipoLancamento: 'recorrente',
    data: null,
    diaDoMes: 5,
    dataInicio: '2026-01-01',
    dataFim: null,
    ...overrides,
  };
}

describe('gerarRelatorio — transações categorizadas', () => {
  it('soma por categoria; sem categoria (null) não entra', () => {
    const r = gerarRelatorio(
      [transacao({ valor: 1000 }), transacao({ valor: 500 }), transacao({ categoriaId: null, valor: 999 })],
      [],
      CATEGORIAS,
      { inicio: '2026-07-01', fim: '2026-07-31' },
    );
    expect(r.porCategoria).toEqual([{ categoriaId: 'receita', total: 1500 }]);
    expect(r.totalReceitas).toBe(1500);
  });

  it('filtra por conta quando informada; consolida quando ausente', () => {
    const dados = [transacao({ contaEmissora: 'mc', valor: 1000 }), transacao({ contaEmissora: 'cavalcante_viana', valor: 300 })];
    const soMc = gerarRelatorio(dados, [], CATEGORIAS, { inicio: '2026-07-01', fim: '2026-07-31' }, 'mc');
    expect(soMc.totalReceitas).toBe(1000);

    const consolidado = gerarRelatorio(dados, [], CATEGORIAS, { inicio: '2026-07-01', fim: '2026-07-31' });
    expect(consolidado.totalReceitas).toBe(1300);
  });
});

describe('gerarRelatorio — lançamento avulso', () => {
  it('entra só se a data cai dentro do período', () => {
    const dentro = gerarRelatorio([], [avulso({ data: '2026-07-15' })], CATEGORIAS, { inicio: '2026-07-01', fim: '2026-07-31' });
    expect(dentro.totalDespesasOperacionais).toBe(500);

    const fora = gerarRelatorio([], [avulso({ data: '2026-08-01' })], CATEGORIAS, { inicio: '2026-07-01', fim: '2026-07-31' });
    expect(fora.totalDespesasOperacionais).toBe(0);
  });
});

describe('gerarRelatorio — expansão de lançamento recorrente (D4)', () => {
  it('um mês fechado gera exatamente 1 instância', () => {
    const r = gerarRelatorio([], [recorrente({ diaDoMes: 5, dataInicio: '2026-01-01' })], CATEGORIAS, {
      inicio: '2026-07-01',
      fim: '2026-07-31',
    });
    expect(r.totalDespesasOperacionais).toBe(500);
  });

  it('período de 3 meses fechados gera 3 instâncias', () => {
    const r = gerarRelatorio([], [recorrente({ diaDoMes: 5, dataInicio: '2026-01-01' })], CATEGORIAS, {
      inicio: '2026-05-01',
      fim: '2026-07-31',
    });
    expect(r.totalDespesasOperacionais).toBe(1500); // 500 × 3
  });

  it('mês parcial no INÍCIO do período: ocorrência antes do corte não entra', () => {
    // diaDoMes=5, período começa dia 10 → a ocorrência de julho (dia 5) já passou.
    const r = gerarRelatorio([], [recorrente({ diaDoMes: 5, dataInicio: '2026-01-01' })], CATEGORIAS, {
      inicio: '2026-07-10',
      fim: '2026-07-31',
    });
    expect(r.totalDespesasOperacionais).toBe(0);
  });

  it('mês parcial no FIM do período: ocorrência depois do corte não entra', () => {
    // diaDoMes=20, período termina dia 10 → a ocorrência de julho (dia 20) é depois do fim.
    const r = gerarRelatorio([], [recorrente({ diaDoMes: 20, dataInicio: '2026-01-01' })], CATEGORIAS, {
      inicio: '2026-07-01',
      fim: '2026-07-10',
    });
    expect(r.totalDespesasOperacionais).toBe(0);
  });

  it('dataInicio do template DEPOIS do início do período: só conta a partir daí', () => {
    // Template só começa em agosto; relatório de junho a agosto só pega agosto.
    const r = gerarRelatorio([], [recorrente({ diaDoMes: 5, dataInicio: '2026-08-01' })], CATEGORIAS, {
      inicio: '2026-06-01',
      fim: '2026-08-31',
    });
    expect(r.totalDespesasOperacionais).toBe(500); // só agosto
  });

  it('dataFim null: recorrência ativa indefinidamente, sem corte superior além do próprio período', () => {
    const r = gerarRelatorio([], [recorrente({ diaDoMes: 5, dataInicio: '2020-01-01', dataFim: null })], CATEGORIAS, {
      inicio: '2026-07-01',
      fim: '2026-09-30',
    });
    expect(r.totalDespesasOperacionais).toBe(1500); // jul+ago+set
  });

  it('dataFim preenchida corta a recorrência antes do fim do período', () => {
    const r = gerarRelatorio(
      [],
      [recorrente({ diaDoMes: 5, dataInicio: '2026-01-01', dataFim: '2026-07-31' })],
      CATEGORIAS,
      { inicio: '2026-06-01', fim: '2026-09-30' },
    );
    // Só junho e julho contam; agosto/setembro já passaram do dataFim.
    expect(r.totalDespesasOperacionais).toBe(1000);
  });

  it('diaDoMes=28 funciona em fevereiro (mês curto) sem erro', () => {
    const r = gerarRelatorio([], [recorrente({ diaDoMes: 28, dataInicio: '2026-01-01' })], CATEGORIAS, {
      inicio: '2026-02-01',
      fim: '2026-02-28',
    });
    expect(r.totalDespesasOperacionais).toBe(500);
  });
});

describe('gerarRelatorio — resultado líquido', () => {
  it('receitas − deduções − despesas operacionais − despesas financeiras', () => {
    const r = gerarRelatorio(
      [
        transacao({ categoriaId: 'receita', valor: 10000 }),
        transacao({ categoriaId: 'tarifa', valor: 50 }),
      ],
      [
        avulso({ categoriaId: 'aluguel', valor: 2000, data: '2026-07-05' }),
        avulso({ categoriaId: 'juros', valor: 100, data: '2026-07-05' }),
      ],
      CATEGORIAS,
      { inicio: '2026-07-01', fim: '2026-07-31' },
    );
    expect(r.totalReceitas).toBe(10000);
    expect(r.totalDeducoes).toBe(50);
    expect(r.totalDespesasOperacionais).toBe(2000);
    expect(r.totalDespesasFinanceiras).toBe(100);
    expect(r.resultadoLiquido).toBe(10000 - 50 - 2000 - 100);
  });

  it('sem nenhum dado → tudo zero, resultado líquido zero', () => {
    const r = gerarRelatorio([], [], CATEGORIAS, { inicio: '2026-07-01', fim: '2026-07-31' });
    expect(r).toEqual({
      porCategoria: [],
      totalReceitas: 0,
      totalDeducoes: 0,
      totalDespesasOperacionais: 0,
      totalDespesasFinanceiras: 0,
      resultadoLiquido: 0,
    });
  });
});
