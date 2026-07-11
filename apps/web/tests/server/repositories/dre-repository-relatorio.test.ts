// Testes de gerarRelatorioDre (Story 9.2, AC 7) — busca bruta mockada, engine real.
// listarLancamentos é função IRMÃ no mesmo arquivo (não mockável via módulo) — mocka-se
// getSupabaseAdmin (mesmo padrão do dre-repository.test.ts da 9.1) para ela; as outras
// duas dependências (listarTransacoes, listarCategorias) vivem em outros arquivos e são
// mockadas por módulo normalmente.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

function makeBuilder(result: { data?: unknown; error?: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

const mockListarTransacoes = vi.fn();
vi.mock('@/server/repositories/extrato-repository', () => ({
  listarTransacoes: (...a: unknown[]) => mockListarTransacoes(...a),
}));

const mockListarCategorias = vi.fn();
vi.mock('@/server/repositories/plano-contas-repository', () => ({
  listarCategorias: (...a: unknown[]) => mockListarCategorias(...a),
}));

import { gerarRelatorioDre } from '@/server/repositories/dre-repository';

const CATEGORIAS = [
  { id: 'cat-receita', grupo: 'receita', nome: 'Receita de honorários', sistema: true, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' },
  { id: 'cat-aluguel', grupo: 'despesa_operacional', nome: 'Despesas administrativas', sistema: false, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue(makeBuilder({ data: [], error: null })); // dre_lancamentos_manuais vazio por padrão
  mockListarCategorias.mockResolvedValue(CATEGORIAS);
});

describe('gerarRelatorioDre', () => {
  it('busca com o período/conta certos e enriquece porCategoria com nome/grupo', async () => {
    mockListarTransacoes.mockResolvedValue([
      { contaEmissora: 'mc', categoriaId: 'cat-receita', valor: 5000 },
    ]);

    const relatorio = await gerarRelatorioDre({ inicio: '2026-07-01', fim: '2026-07-31' }, 'mc');

    expect(mockListarTransacoes).toHaveBeenCalledWith({
      contaEmissora: 'mc',
      dataInicio: '2026-07-01T00:00:00.000-03:00',
      dataFim: '2026-07-31T23:59:59.999-03:00',
    });
    expect(relatorio.totalReceitas).toBe(5000);
    expect(relatorio.porCategoria).toEqual([
      { categoriaId: 'cat-receita', nome: 'Receita de honorários', grupo: 'receita', total: 5000 },
    ]);
  });

  it('conta ausente → consolidado (lista lançamentos sem filtro de conta)', async () => {
    mockListarTransacoes.mockResolvedValue([]);
    await gerarRelatorioDre({ inicio: '2026-07-01', fim: '2026-07-31' });
    expect(mockListarTransacoes).toHaveBeenCalledWith({
      contaEmissora: undefined,
      dataInicio: '2026-07-01T00:00:00.000-03:00',
      dataFim: '2026-07-31T23:59:59.999-03:00',
    });
    // listarLancamentos (função irmã) sem filtro de conta → não chama .eq('conta_emissora', ...)
    const builder = mockFrom.mock.results[0]?.value;
    expect(builder.eq).not.toHaveBeenCalledWith('conta_emissora', expect.anything());
  });

  it('resultado líquido reflete receita menos despesa (lançamento avulso real do banco)', async () => {
    mockListarTransacoes.mockResolvedValue([
      { contaEmissora: 'mc', categoriaId: 'cat-receita', valor: 10000 },
    ]);
    mockFrom.mockReturnValue(
      makeBuilder({
        data: [
          {
            id: 'l1', conta_emissora: 'mc', categoria_id: 'cat-aluguel', descricao: 'Aluguel', valor: 2000,
            tipo_lancamento: 'avulso', data: '2026-07-05', dia_do_mes: null, data_inicio: null, data_fim: null,
            criado_por: 'u1', criado_em: '2026-07-01T00:00:00Z',
          },
        ],
        error: null,
      }),
    );

    const relatorio = await gerarRelatorioDre({ inicio: '2026-07-01', fim: '2026-07-31' });
    expect(relatorio.resultadoLiquido).toBe(8000);
  });
});
