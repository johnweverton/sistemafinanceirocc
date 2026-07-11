// Testes do dre-repository (Story 9.1, AC 4) — getSupabaseAdmin mockado.
// Chave da story: validação cruzada avulso/recorrente ANTES de bater no banco, nos dois
// sentidos (mesmo espírito do CHECK cruzado da migration 0023).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import {
  criarLancamento,
  listarLancamentos,
  excluirLancamento,
  type CriarLancamentoInput,
} from '@/server/repositories/dre-repository';
import { ApiError } from '@/lib/api-error';

function makeBuilder(result: { data?: unknown; error?: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

const ROW_AVULSO = {
  id: 'l1',
  conta_emissora: 'mc',
  categoria_id: 'cat-1',
  descricao: 'Reforma da sala',
  valor: 500,
  tipo_lancamento: 'avulso',
  data: '2026-07-11',
  dia_do_mes: null,
  data_inicio: null,
  data_fim: null,
  criado_por: 'user-1',
  criado_em: '2026-07-11T00:00:00Z',
};

const ROW_RECORRENTE = {
  ...ROW_AVULSO,
  id: 'l2',
  descricao: 'Aluguel',
  tipo_lancamento: 'recorrente',
  data: null,
  dia_do_mes: 5,
  data_inicio: '2026-07-01',
  data_fim: null,
};

beforeEach(() => vi.clearAllMocks());

describe('criarLancamento', () => {
  it('cria lançamento avulso válido', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: ROW_AVULSO, error: null }));
    const input: CriarLancamentoInput = {
      tipoLancamento: 'avulso',
      contaEmissora: 'mc',
      categoriaId: 'cat-1',
      descricao: 'Reforma da sala',
      valor: 500,
      data: '2026-07-11',
      criadoPor: 'user-1',
    };
    const r = await criarLancamento(input);
    expect(r).toMatchObject({ tipoLancamento: 'avulso', data: '2026-07-11', diaDoMes: null });
  });

  it('cria lançamento recorrente válido', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: ROW_RECORRENTE, error: null }));
    const input: CriarLancamentoInput = {
      tipoLancamento: 'recorrente',
      contaEmissora: 'mc',
      categoriaId: 'cat-1',
      descricao: 'Aluguel',
      valor: 500,
      diaDoMes: 5,
      dataInicio: '2026-07-01',
      criadoPor: 'user-1',
    };
    const r = await criarLancamento(input);
    expect(r).toMatchObject({ tipoLancamento: 'recorrente', diaDoMes: 5, dataInicio: '2026-07-01' });
  });

  it('rejeita avulso sem "data" ANTES de bater no banco', async () => {
    const input = {
      tipoLancamento: 'avulso',
      contaEmissora: 'mc',
      categoriaId: 'cat-1',
      descricao: 'x',
      valor: 1,
      data: '',
      criadoPor: 'user-1',
    } as CriarLancamentoInput;

    await expect(criarLancamento(input)).rejects.toMatchObject({ status: 422 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejeita recorrente com diaDoMes fora de 1-28 ANTES de bater no banco', async () => {
    const input: CriarLancamentoInput = {
      tipoLancamento: 'recorrente',
      contaEmissora: 'mc',
      categoriaId: 'cat-1',
      descricao: 'Aluguel',
      valor: 500,
      diaDoMes: 31,
      dataInicio: '2026-07-01',
      criadoPor: 'user-1',
    };

    await expect(criarLancamento(input)).rejects.toBeInstanceOf(ApiError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejeita recorrente com diaDoMes NaN ou fracionário (QA-911-1)', async () => {
    const base: CriarLancamentoInput = {
      tipoLancamento: 'recorrente',
      contaEmissora: 'mc',
      categoriaId: 'cat-1',
      descricao: 'Aluguel',
      valor: 500,
      diaDoMes: NaN,
      dataInicio: '2026-07-01',
      criadoPor: 'user-1',
    };
    await expect(criarLancamento(base)).rejects.toMatchObject({ status: 422 });
    await expect(criarLancamento({ ...base, diaDoMes: 15.5 })).rejects.toMatchObject({ status: 422 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejeita recorrente sem dataInicio', async () => {
    const input = {
      tipoLancamento: 'recorrente',
      contaEmissora: 'mc',
      categoriaId: 'cat-1',
      descricao: 'Aluguel',
      valor: 500,
      diaDoMes: 5,
      dataInicio: '',
      criadoPor: 'user-1',
    } as CriarLancamentoInput;

    await expect(criarLancamento(input)).rejects.toMatchObject({ status: 422 });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('listarLancamentos', () => {
  it('filtra por conta e tipo quando informados', async () => {
    const builder = makeBuilder({ data: [ROW_AVULSO], error: null });
    mockFrom.mockReturnValueOnce(builder);
    const r = await listarLancamentos({ contaEmissora: 'mc', tipoLancamento: 'avulso' });
    expect(r).toHaveLength(1);
    expect(builder.eq).toHaveBeenCalledWith('conta_emissora', 'mc');
    expect(builder.eq).toHaveBeenCalledWith('tipo_lancamento', 'avulso');
  });

  it('sem filtro lista tudo', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: [ROW_AVULSO, ROW_RECORRENTE], error: null }));
    const r = await listarLancamentos();
    expect(r).toHaveLength(2);
  });
});

describe('excluirLancamento', () => {
  it('deleta por id', async () => {
    const builder = makeBuilder({ error: null });
    mockFrom.mockReturnValueOnce(builder);
    await excluirLancamento('l1');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'l1');
  });
});
