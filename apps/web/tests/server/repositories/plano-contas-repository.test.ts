// Testes do plano-contas-repository (Story 9.1, AC 3) — getSupabaseAdmin mockado.
// Chaves da story: categoria sistema=true nunca aceita DELETE/desativação; DELETE físico
// só com categoria ativa e zero vínculos; grupo/sistema nunca são atualizáveis (por
// assinatura da função, não por guard condicional).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import {
  criarCategoria,
  listarCategorias,
  atualizarCategoria,
  desativarCategoria,
  excluirCategoria,
  criarRegra,
  listarRegras,
  atualizarRegra,
  desativarRegra,
} from '@/server/repositories/plano-contas-repository';
import { ApiError } from '@/lib/api-error';

/** Builder "thenable" que registra as chamadas e resolve o resultado no await. */
function makeBuilder(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

const CATEGORIA_SISTEMA = {
  id: 'cat-sistema',
  grupo: 'receita',
  nome: 'Receita de honorários',
  sistema: true,
  ativo: true,
  ordem: 0,
  criado_em: '2026-07-11T00:00:00Z',
};

const CATEGORIA_COMUM = {
  id: 'cat-comum',
  grupo: 'despesa_operacional',
  nome: 'Despesas administrativas',
  sistema: false,
  ativo: true,
  ordem: 0,
  criado_em: '2026-07-11T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('categorias (plano_contas)', () => {
  it('cria categoria', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: CATEGORIA_COMUM, error: null }));
    const r = await criarCategoria({ grupo: 'despesa_operacional', nome: 'Despesas administrativas' });
    expect(r).toMatchObject({ nome: 'Despesas administrativas', sistema: false });
  });

  it('lista categorias, aplica filtro ativo quando informado', async () => {
    const builder = makeBuilder({ data: [CATEGORIA_SISTEMA, CATEGORIA_COMUM], error: null });
    mockFrom.mockReturnValueOnce(builder);
    const r = await listarCategorias({ ativo: true });
    expect(r).toHaveLength(2);
    expect(builder.eq).toHaveBeenCalledWith('ativo', true);
  });

  it('atualizarCategoria só aceita nome/ordem — sem parâmetro para grupo/sistema', async () => {
    mockFrom.mockReturnValueOnce(
      makeBuilder({ data: { ...CATEGORIA_COMUM, nome: 'Novo nome' }, error: null }),
    );
    const r = await atualizarCategoria('cat-comum', { nome: 'Novo nome' });
    expect(r.nome).toBe('Novo nome');
    // Nenhum caminho do código aceita grupo/sistema no patch — garantido pelo tipo
    // AtualizarCategoriaInput, verificado em tempo de compilação (typecheck da story).
  });

  it('desativarCategoria rejeita categoria sistema=true', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: CATEGORIA_SISTEMA, error: null })); // buscarCategoria

    await expect(desativarCategoria('cat-sistema')).rejects.toMatchObject({
      code: 'CATEGORIA_SISTEMA_PROTEGIDA',
    });
    // Só o SELECT de busca aconteceu — nenhum UPDATE foi tentado.
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('desativarCategoria funciona para categoria comum', async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: CATEGORIA_COMUM, error: null })) // buscarCategoria
      .mockReturnValueOnce(makeBuilder({ data: { ...CATEGORIA_COMUM, ativo: false }, error: null })); // update

    const r = await desativarCategoria('cat-comum');
    expect(r.ativo).toBe(false);
  });

  it('excluirCategoria rejeita categoria sistema=true', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: CATEGORIA_SISTEMA, error: null }));

    await expect(excluirCategoria('cat-sistema')).rejects.toMatchObject({
      code: 'CATEGORIA_SISTEMA_PROTEGIDA',
    });
  });

  it('excluirCategoria rejeita categoria já inativa', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: { ...CATEGORIA_COMUM, ativo: false }, error: null }));

    await expect(excluirCategoria('cat-comum')).rejects.toMatchObject({
      code: 'CATEGORIA_INATIVA',
    });
  });

  it('excluirCategoria rejeita categoria com vínculos (409 CATEGORIA_EM_USO)', async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: CATEGORIA_COMUM, error: null })) // buscarCategoria
      .mockReturnValueOnce(makeBuilder({ count: 2, error: null })) // extrato_transacoes
      .mockReturnValueOnce(makeBuilder({ count: 0, error: null })) // dre_lancamentos_manuais
      .mockReturnValueOnce(makeBuilder({ count: 0, error: null })); // plano_contas_regras

    await expect(excluirCategoria('cat-comum')).rejects.toMatchObject({
      code: 'CATEGORIA_EM_USO',
      status: 409,
    });
  });

  it('excluirCategoria deleta fisicamente quando ativa e sem vínculos', async () => {
    const deleteBuilder = makeBuilder({ error: null });
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: CATEGORIA_COMUM, error: null })) // buscarCategoria
      .mockReturnValueOnce(makeBuilder({ count: 0, error: null }))
      .mockReturnValueOnce(makeBuilder({ count: 0, error: null }))
      .mockReturnValueOnce(makeBuilder({ count: 0, error: null }))
      .mockReturnValueOnce(deleteBuilder);

    await excluirCategoria('cat-comum');
    expect(deleteBuilder.delete).toHaveBeenCalled();
    expect(deleteBuilder.eq).toHaveBeenCalledWith('id', 'cat-comum');
  });
});

describe('regras (plano_contas_regras)', () => {
  const REGRA = {
    id: 'regra-1',
    categoria_id: 'cat-comum',
    campo: 'descricao',
    padrao: 'aluguel',
    prioridade: 0,
    ativo: true,
    criado_em: '2026-07-11T00:00:00Z',
  };

  it('cria regra', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: REGRA, error: null }));
    const r = await criarRegra({ categoriaId: 'cat-comum', campo: 'descricao', padrao: 'aluguel' });
    expect(r).toMatchObject({ categoriaId: 'cat-comum', padrao: 'aluguel' });
  });

  it('lista regras ordenadas por prioridade', async () => {
    const builder = makeBuilder({ data: [REGRA], error: null });
    mockFrom.mockReturnValueOnce(builder);
    const r = await listarRegras();
    expect(r).toHaveLength(1);
    expect(builder.order).toHaveBeenCalledWith('prioridade');
  });

  it('atualiza regra', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: { ...REGRA, prioridade: 5 }, error: null }));
    const r = await atualizarRegra('regra-1', { prioridade: 5 });
    expect(r.prioridade).toBe(5);
  });

  it('atualizarRegra em id inexistente → 404', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: null, error: null }));
    await expect(atualizarRegra('inexistente', { prioridade: 1 })).rejects.toBeInstanceOf(ApiError);
  });

  it('desativa regra', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: { ...REGRA, ativo: false }, error: null }));
    const r = await desativarRegra('regra-1');
    expect(r.ativo).toBe(false);
  });
});
