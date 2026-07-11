// Testes da rota POST /api/extrato/[id]/categorizar (Story 9.2, AC 5) — deps mockadas.
// Chaves: categoriaId no corpo é sempre aceito (confirmada); sem corpo roda o motor
// (engine real) e só grava quando bate alguma regra.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockBuscarTransacao = vi.fn();
const mockCategorizarTransacao = vi.fn();
vi.mock('@/server/repositories/extrato-repository', () => ({
  buscarTransacao: (...a: unknown[]) => mockBuscarTransacao(...a),
  categorizarTransacao: (...a: unknown[]) => mockCategorizarTransacao(...a),
}));

const mockBuscarCategoriasSistema = vi.fn();
const mockListarRegras = vi.fn();
vi.mock('@/server/repositories/plano-contas-repository', () => ({
  buscarCategoriasSistema: (...a: unknown[]) => mockBuscarCategoriasSistema(...a),
  listarRegras: (...a: unknown[]) => mockListarRegras(...a),
}));

import { POST } from '@/app/api/extrato/[id]/categorizar/route';

const CATEGORIA_ID = '11111111-1111-1111-1111-111111111111';

function transacaoBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    contaEmissora: 'mc',
    entryId: 'e1',
    tipo: 'CREDIT',
    transactionType: 'PAYMENT',
    valor: 1500,
    descricao: null,
    contraparteNome: null,
    contraparteDocumento: null,
    dataTransacao: '2026-07-08T10:00:00Z',
    statusConciliacao: 'conciliado_manual',
    boletoId: 'b1',
    conciliadoPor: 'u1',
    conciliadoEm: '2026-07-08T10:00:00Z',
    payload: {},
    sincronizadoEm: '2026-07-10T00:00:00Z',
    categoriaId: null,
    statusCategorizacao: 'sem_categoria',
    ...overrides,
  };
}

function post(body: unknown, userId = 'user-fin') {
  mockRequireRole.mockResolvedValue({ userId, papel: 'financeiro' });
  const req = new Request('http://test/api/extrato/tx-1/categorizar', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return POST(req, { params: { id: 'tx-1' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBuscarCategoriasSistema.mockResolvedValue({
    receitaHonorariosId: 'cat-receita',
    tarifasBancariasId: 'cat-tarifa',
  });
  mockListarRegras.mockResolvedValue([]);
});

describe('POST /api/extrato/[id]/categorizar — correção manual (categoriaId no corpo)', () => {
  it('sempre aceita, mesmo sem sugestão prévia — vira confirmada', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase());
    mockCategorizarTransacao.mockResolvedValue(
      transacaoBase({ categoriaId: CATEGORIA_ID, statusCategorizacao: 'confirmada' }),
    );

    const res = await post({ categoriaId: CATEGORIA_ID });
    expect(res.status).toBe(200);
    expect(mockCategorizarTransacao).toHaveBeenCalledWith('tx-1', {
      categoriaId: CATEGORIA_ID,
      status: 'confirmada',
    });
    // O motor não é chamado quando há correção manual explícita.
    expect(mockBuscarCategoriasSistema).not.toHaveBeenCalled();
  });

  it('categoriaId inválido (não-UUID) → 400', async () => {
    mockBuscarTransacao.mockResolvedValue(transacaoBase());
    const res = await post({ categoriaId: 'não-é-uuid' });
    expect(res.status).toBe(400);
    expect(mockCategorizarTransacao).not.toHaveBeenCalled();
  });

  it('transação inexistente → 404', async () => {
    mockBuscarTransacao.mockResolvedValue(null);
    const res = await post({ categoriaId: CATEGORIA_ID });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/extrato/[id]/categorizar — sem corpo, roda o motor (engine real)', () => {
  it('crédito conciliado → Receita de honorários, confirmada, e persiste', async () => {
    mockBuscarTransacao.mockResolvedValue(
      transacaoBase({ tipo: 'CREDIT', statusConciliacao: 'conciliado_auto' }),
    );
    mockCategorizarTransacao.mockResolvedValue(
      transacaoBase({ categoriaId: 'cat-receita', statusCategorizacao: 'confirmada' }),
    );

    const res = await post(undefined);
    expect(res.status).toBe(200);
    expect(mockCategorizarTransacao).toHaveBeenCalledWith('tx-1', {
      categoriaId: 'cat-receita',
      status: 'confirmada',
    });
  });

  it('regra do usuário bate → sugerida, persiste', async () => {
    mockBuscarTransacao.mockResolvedValue(
      transacaoBase({ tipo: 'DEBIT', transactionType: 'TRANSFER', descricao: 'Aluguel' }),
    );
    mockListarRegras.mockResolvedValue([
      { id: 'r1', categoriaId: 'cat-aluguel', campo: 'descricao', padrao: 'aluguel', prioridade: 0, ativo: true, criadoEm: '2026-07-11T00:00:00Z' },
    ]);
    mockCategorizarTransacao.mockResolvedValue(
      transacaoBase({ categoriaId: 'cat-aluguel', statusCategorizacao: 'sugerida' }),
    );

    const res = await post(undefined);
    expect(res.status).toBe(200);
    expect(mockCategorizarTransacao).toHaveBeenCalledWith('tx-1', {
      categoriaId: 'cat-aluguel',
      status: 'sugerida',
    });
  });

  it('nenhuma regra bate → sem_categoria, NÃO persiste, devolve a transação como está', async () => {
    const transacao = transacaoBase({ tipo: 'DEBIT', transactionType: 'TRANSFER', descricao: 'algo aleatório' });
    mockBuscarTransacao.mockResolvedValue(transacao);

    const res = await post(undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transacao).toEqual(transacao);
    expect(mockCategorizarTransacao).not.toHaveBeenCalled();
  });
});
