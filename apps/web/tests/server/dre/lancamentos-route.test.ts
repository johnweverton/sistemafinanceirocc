// Testes das rotas de lançamentos manuais (Story 9.2, AC 6) — deps mockadas.
// Chaves: Zod discriminado por tipoLancamento rejeita mistura de campos ANTES do
// repository; criadoPor vem da sessão, não do corpo.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockCriarLancamento = vi.fn();
const mockListarLancamentos = vi.fn();
const mockExcluirLancamento = vi.fn();
vi.mock('@/server/repositories/dre-repository', () => ({
  criarLancamento: (...a: unknown[]) => mockCriarLancamento(...a),
  listarLancamentos: (...a: unknown[]) => mockListarLancamentos(...a),
  excluirLancamento: (...a: unknown[]) => mockExcluirLancamento(...a),
}));

import { GET, POST } from '@/app/api/dre/lancamentos/route';
import { DELETE } from '@/app/api/dre/lancamentos/[id]/route';

const CATEGORIA_ID = '11111111-1111-1111-1111-111111111111';

function reqGet(qs = '') {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/dre/lancamentos${qs}`), { params: {} as Record<string, never> });
}

function reqPost(body: unknown) {
  mockRequireRole.mockResolvedValue({ userId: 'user-1', papel: 'financeiro' });
  return POST(
    new Request('http://test/api/dre/lancamentos', { method: 'POST', body: JSON.stringify(body) }),
    { params: {} as Record<string, never> },
  );
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/dre/lancamentos', () => {
  it('lista sem filtros', async () => {
    mockListarLancamentos.mockResolvedValue([]);
    const res = await reqGet();
    expect(res.status).toBe(200);
    expect(mockListarLancamentos).toHaveBeenCalledWith({ contaEmissora: undefined, tipoLancamento: undefined });
  });

  it('repassa filtros conta/tipo', async () => {
    mockListarLancamentos.mockResolvedValue([]);
    await reqGet('?conta=mc&tipo=avulso');
    expect(mockListarLancamentos).toHaveBeenCalledWith({ contaEmissora: 'mc', tipoLancamento: 'avulso' });
  });

  it('conta fora da whitelist → 400', async () => {
    const res = await reqGet('?conta=banco-invalido');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/dre/lancamentos', () => {
  it('cria avulso com criadoPor da sessão (não do corpo)', async () => {
    mockCriarLancamento.mockResolvedValue({ id: 'l1' });
    const res = await reqPost({
      tipoLancamento: 'avulso',
      contaEmissora: 'mc',
      categoriaId: CATEGORIA_ID,
      descricao: 'Reforma',
      valor: 500,
      data: '2026-07-11',
    });
    expect(res.status).toBe(201);
    expect(mockCriarLancamento).toHaveBeenCalledWith(
      expect.objectContaining({ tipoLancamento: 'avulso', data: '2026-07-11', criadoPor: 'user-1' }),
    );
  });

  it('cria recorrente', async () => {
    mockCriarLancamento.mockResolvedValue({ id: 'l2' });
    const res = await reqPost({
      tipoLancamento: 'recorrente',
      contaEmissora: 'mc',
      categoriaId: CATEGORIA_ID,
      descricao: 'Aluguel',
      valor: 2000,
      diaDoMes: 5,
      dataInicio: '2026-07-01',
    });
    expect(res.status).toBe(201);
    expect(mockCriarLancamento).toHaveBeenCalledWith(
      expect.objectContaining({ tipoLancamento: 'recorrente', diaDoMes: 5, dataInicio: '2026-07-01' }),
    );
  });

  it('avulso sem "data" (campo obrigatório do próprio ramo) → 422 ANTES do repository', async () => {
    const res = await reqPost({
      tipoLancamento: 'avulso',
      contaEmissora: 'mc',
      categoriaId: CATEGORIA_ID,
      descricao: 'x',
      valor: 100,
    });
    expect(res.status).toBe(422);
    expect(mockCriarLancamento).not.toHaveBeenCalled();
  });

  it('recorrente sem "dataInicio" (campo obrigatório do próprio ramo) → 422', async () => {
    const res = await reqPost({
      tipoLancamento: 'recorrente',
      contaEmissora: 'mc',
      categoriaId: CATEGORIA_ID,
      descricao: 'Aluguel',
      valor: 2000,
      diaDoMes: 5,
    });
    expect(res.status).toBe(422);
    expect(mockCriarLancamento).not.toHaveBeenCalled();
  });

  it('recorrente com diaDoMes fora de 1-28 → 422', async () => {
    const res = await reqPost({
      tipoLancamento: 'recorrente',
      contaEmissora: 'mc',
      categoriaId: CATEGORIA_ID,
      descricao: 'Aluguel',
      valor: 2000,
      diaDoMes: 31,
      dataInicio: '2026-07-01',
    });
    expect(res.status).toBe(422);
  });

  it('valor negativo → 422', async () => {
    const res = await reqPost({
      tipoLancamento: 'avulso',
      contaEmissora: 'mc',
      categoriaId: CATEGORIA_ID,
      descricao: 'x',
      valor: -10,
      data: '2026-07-11',
    });
    expect(res.status).toBe(422);
  });

  it('tipoLancamento inválido → 422', async () => {
    const res = await reqPost({ tipoLancamento: 'esporadico', contaEmissora: 'mc', categoriaId: CATEGORIA_ID, descricao: 'x', valor: 1 });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/dre/lancamentos/[id]', () => {
  it('exclui → 204', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'admin' });
    mockExcluirLancamento.mockResolvedValue(undefined);
    const req = new Request('http://test/api/dre/lancamentos/l1', { method: 'DELETE' });
    const res = await DELETE(req, { params: { id: 'l1' } });
    expect(res.status).toBe(204);
    expect(mockExcluirLancamento).toHaveBeenCalledWith('l1');
  });
});
