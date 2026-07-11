// Testes das rotas de regras de categorização (Story 9.2, AC 4) — deps mockadas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockCriarRegra = vi.fn();
const mockListarRegras = vi.fn();
const mockAtualizarRegra = vi.fn();
const mockDesativarRegra = vi.fn();
const mockExcluirRegra = vi.fn();
vi.mock('@/server/repositories/plano-contas-repository', () => ({
  criarRegra: (...a: unknown[]) => mockCriarRegra(...a),
  listarRegras: (...a: unknown[]) => mockListarRegras(...a),
  atualizarRegra: (...a: unknown[]) => mockAtualizarRegra(...a),
  desativarRegra: (...a: unknown[]) => mockDesativarRegra(...a),
  excluirRegra: (...a: unknown[]) => mockExcluirRegra(...a),
}));

import { GET, POST } from '@/app/api/plano-contas/regras/route';
import { PATCH, DELETE } from '@/app/api/plano-contas/regras/[id]/route';

const CATEGORIA_ID = '11111111-1111-1111-1111-111111111111';
const REGRA = { id: 'r1', categoriaId: CATEGORIA_ID, campo: 'descricao', padrao: 'aluguel', prioridade: 0, ativo: true, criadoEm: '2026-07-11T00:00:00Z' };
const SEM_PARAMS = { params: {} as Record<string, never> };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'admin' });
});

describe('GET /api/plano-contas/regras', () => {
  it('lista regras', async () => {
    mockListarRegras.mockResolvedValue([REGRA]);
    const res = await GET(new Request('http://test/api/plano-contas/regras'), SEM_PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([REGRA]);
  });
});

describe('POST /api/plano-contas/regras', () => {
  it('cria regra', async () => {
    mockCriarRegra.mockResolvedValue(REGRA);
    const res = await POST(
      new Request('http://test/api/plano-contas/regras', {
        method: 'POST',
        body: JSON.stringify({ categoriaId: CATEGORIA_ID, campo: 'descricao', padrao: 'aluguel' }),
      }),
      SEM_PARAMS,
    );
    expect(res.status).toBe(201);
    expect(mockCriarRegra).toHaveBeenCalledWith({ categoriaId: CATEGORIA_ID, campo: 'descricao', padrao: 'aluguel' });
  });

  it('campo fora da whitelist → 422', async () => {
    const res = await POST(
      new Request('http://test/api/plano-contas/regras', {
        method: 'POST',
        body: JSON.stringify({ categoriaId: CATEGORIA_ID, campo: 'invalido', padrao: 'x' }),
      }),
      SEM_PARAMS,
    );
    expect(res.status).toBe(422);
    expect(mockCriarRegra).not.toHaveBeenCalled();
  });

  it('categoriaId não-UUID → 422', async () => {
    const res = await POST(
      new Request('http://test/api/plano-contas/regras', {
        method: 'POST',
        body: JSON.stringify({ categoriaId: 'não-é-uuid', campo: 'descricao', padrao: 'x' }),
      }),
      SEM_PARAMS,
    );
    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/plano-contas/regras/[id]', () => {
  function reqPatch(body: unknown) {
    const req = new Request('http://test/api/plano-contas/regras/r1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return PATCH(req, { params: { id: 'r1' } });
  }

  it('atualiza campo/padrao/prioridade', async () => {
    mockAtualizarRegra.mockResolvedValue({ ...REGRA, prioridade: 5 });
    const res = await reqPatch({ prioridade: 5 });
    expect(res.status).toBe(200);
    expect(mockAtualizarRegra).toHaveBeenCalledWith('r1', { campo: undefined, padrao: undefined, prioridade: 5 });
    expect(mockDesativarRegra).not.toHaveBeenCalled();
  });

  it('ativo:false chama desativarRegra', async () => {
    mockDesativarRegra.mockResolvedValue({ ...REGRA, ativo: false });
    const res = await reqPatch({ ativo: false });
    expect(res.status).toBe(200);
    expect(mockDesativarRegra).toHaveBeenCalledWith('r1');
    expect(mockAtualizarRegra).not.toHaveBeenCalled();
  });

  it('corpo vazio (QA-921-1) → 422 claro, nunca bate no repository', async () => {
    const res = await reqPatch({});
    expect(res.status).toBe(422);
    expect(mockAtualizarRegra).not.toHaveBeenCalled();
    expect(mockDesativarRegra).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/plano-contas/regras/[id]', () => {
  it('exclui fisicamente → 204', async () => {
    mockExcluirRegra.mockResolvedValue(undefined);
    const req = new Request('http://test/api/plano-contas/regras/r1', { method: 'DELETE' });
    const res = await DELETE(req, { params: { id: 'r1' } });
    expect(res.status).toBe(204);
    expect(mockExcluirRegra).toHaveBeenCalledWith('r1');
  });
});
