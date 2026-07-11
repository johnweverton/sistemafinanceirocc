// Bateria do motor de categorização (Story 9.2, AC 1) — as 2 auto-regras de sistema
// nunca cedem a uma regra de usuário conflitante (checadas primeiro); regra de usuário
// nunca confirma sozinha (sempre 'sugerida').
import { describe, it, expect } from 'vitest';
import {
  categorizar,
  type TransacaoParaCategorizar,
  type RegraParaCategorizar,
  type CategoriasSistema,
} from '@/server/engine/categorizacao';

const CATEGORIAS: CategoriasSistema = {
  receitaHonorariosId: 'cat-receita',
  tarifasBancariasId: 'cat-tarifa',
};

function transacao(
  id: string,
  overrides: Partial<TransacaoParaCategorizar> = {},
): TransacaoParaCategorizar {
  return {
    transacaoId: id,
    tipo: 'CREDIT',
    transactionType: 'PAYMENT',
    contraparteNome: null,
    descricao: null,
    conciliadaComBoleto: false,
    ...overrides,
  };
}

describe('categorizar — auto-regras de sistema', () => {
  it('CREDIT conciliado com boleto → Receita de honorários, confirmada', () => {
    const r = categorizar([transacao('t1', { conciliadaComBoleto: true })], [], CATEGORIAS);
    expect(r).toEqual([{ transacaoId: 't1', categoriaId: 'cat-receita', status: 'confirmada' }]);
  });

  it('DEBIT com transactionType FEE → Tarifas bancárias, confirmada', () => {
    const r = categorizar(
      [transacao('t1', { tipo: 'DEBIT', transactionType: 'FEE' })],
      [],
      CATEGORIAS,
    );
    expect(r).toEqual([{ transacaoId: 't1', categoriaId: 'cat-tarifa', status: 'confirmada' }]);
  });

  it('CREDIT não conciliado não vira Receita de honorários automaticamente', () => {
    const r = categorizar([transacao('t1', { conciliadaComBoleto: false })], [], CATEGORIAS);
    expect(r[0]?.status).toBe('sem_categoria');
  });

  it('DEBIT sem ser FEE não vira Tarifas bancárias', () => {
    const r = categorizar(
      [transacao('t1', { tipo: 'DEBIT', transactionType: 'TRANSFER' })],
      [],
      CATEGORIAS,
    );
    expect(r[0]?.status).toBe('sem_categoria');
  });

  it('auto-regra de sistema vence mesmo com uma regra de usuário que também bateria', () => {
    const regras: RegraParaCategorizar[] = [
      { categoriaId: 'cat-outra', campo: 'descricao', padrao: 'liquidação', prioridade: 0 },
    ];
    const r = categorizar(
      [transacao('t1', { conciliadaComBoleto: true, descricao: 'Liquidação de boleto' })],
      regras,
      CATEGORIAS,
    );
    // Vence a auto-regra (confirmada, cat-receita) — a regra de usuário nunca é avaliada.
    expect(r).toEqual([{ transacaoId: 't1', categoriaId: 'cat-receita', status: 'confirmada' }]);
  });
});

describe('categorizar — regras do usuário (sempre sugerida)', () => {
  it('regra por contraparte_nome bate (substring, case-insensitive)', () => {
    const regras: RegraParaCategorizar[] = [
      { categoriaId: 'cat-aluguel', campo: 'contraparte_nome', padrao: 'imobiliaria', prioridade: 0 },
    ];
    const r = categorizar(
      [transacao('t1', { tipo: 'DEBIT', contraparteNome: 'IMOBILIARIA CENTRAL LTDA' })],
      regras,
      CATEGORIAS,
    );
    expect(r).toEqual([{ transacaoId: 't1', categoriaId: 'cat-aluguel', status: 'sugerida' }]);
  });

  it('regra por descricao bate', () => {
    const regras: RegraParaCategorizar[] = [
      { categoriaId: 'cat-agua', campo: 'descricao', padrao: 'saneamento', prioridade: 0 },
    ];
    const r = categorizar(
      [transacao('t1', { tipo: 'DEBIT', descricao: 'Pagamento Cia de Saneamento' })],
      regras,
      CATEGORIAS,
    );
    expect(r[0]).toMatchObject({ categoriaId: 'cat-agua', status: 'sugerida' });
  });

  it('regra nunca confirma sozinha — status é sempre sugerida, mesmo com match perfeito', () => {
    const regras: RegraParaCategorizar[] = [
      { categoriaId: 'cat-x', campo: 'descricao', padrao: 'exato', prioridade: 0 },
    ];
    const r = categorizar([transacao('t1', { tipo: 'DEBIT', descricao: 'exato' })], regras, CATEGORIAS);
    expect(r[0]?.status).toBe('sugerida');
  });

  it('prioridade decide quando 2 regras batem — menor prioridade vence', () => {
    const regras: RegraParaCategorizar[] = [
      { categoriaId: 'cat-baixa-prioridade', campo: 'descricao', padrao: 'pagamento', prioridade: 5 },
      { categoriaId: 'cat-alta-prioridade', campo: 'descricao', padrao: 'pagamento', prioridade: 0 },
    ];
    const r = categorizar(
      [transacao('t1', { tipo: 'DEBIT', descricao: 'Pagamento diverso' })],
      regras,
      CATEGORIAS,
    );
    expect(r[0]?.categoriaId).toBe('cat-alta-prioridade');
  });

  it('regra ignora campo null e cai para sem_categoria', () => {
    const regras: RegraParaCategorizar[] = [
      { categoriaId: 'cat-x', campo: 'contraparte_nome', padrao: 'qualquer', prioridade: 0 },
    ];
    const r = categorizar([transacao('t1', { tipo: 'DEBIT', contraparteNome: null })], regras, CATEGORIAS);
    expect(r[0]?.status).toBe('sem_categoria');
  });

  it('nenhuma regra bate → sem_categoria com categoriaId null', () => {
    const r = categorizar([transacao('t1', { tipo: 'DEBIT', descricao: 'algo aleatório' })], [], CATEGORIAS);
    expect(r).toEqual([{ transacaoId: 't1', categoriaId: null, status: 'sem_categoria' }]);
  });
});

describe('categorizar — determinismo e ordenação', () => {
  it('processa lote misto preservando a ordem de entrada', () => {
    const r = categorizar(
      [
        transacao('a', { conciliadaComBoleto: true }),
        transacao('b', { tipo: 'DEBIT', transactionType: 'FEE' }),
        transacao('c'),
      ],
      [],
      CATEGORIAS,
    );
    expect(r.map((x) => x.transacaoId)).toEqual(['a', 'b', 'c']);
  });

  it('caller passa regras fora de ordem — o motor reordena por prioridade internamente', () => {
    const regras: RegraParaCategorizar[] = [
      { categoriaId: 'cat-baixa', campo: 'descricao', padrao: 'x', prioridade: 10 },
      { categoriaId: 'cat-alta', campo: 'descricao', padrao: 'x', prioridade: 1 },
    ];
    const r = categorizar([transacao('t1', { tipo: 'DEBIT', descricao: 'x' })], regras, CATEGORIAS);
    expect(r[0]?.categoriaId).toBe('cat-alta');
  });
});
