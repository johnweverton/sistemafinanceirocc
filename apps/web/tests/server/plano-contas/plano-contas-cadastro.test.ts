// Testes das rotas de cadastro do plano de contas (Story 9.2, AC 3) — deps mockadas.
// Chaves: leitura admin/financeiro, escrita admin; PATCH ativo:false desativa em vez de
// renomear; DELETE propaga os erros do repository com o status certo (400/400/409).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockCriarCategoria = vi.fn();
const mockListarCategorias = vi.fn();
const mockAtualizarCategoria = vi.fn();
const mockDesativarCategoria = vi.fn();
const mockExcluirCategoria = vi.fn();
vi.mock('@/server/repositories/plano-contas-repository', () => ({
  criarCategoria: (...a: unknown[]) => mockCriarCategoria(...a),
  listarCategorias: (...a: unknown[]) => mockListarCategorias(...a),
  atualizarCategoria: (...a: unknown[]) => mockAtualizarCategoria(...a),
  desativarCategoria: (...a: unknown[]) => mockDesativarCategoria(...a),
  excluirCategoria: (...a: unknown[]) => mockExcluirCategoria(...a),
}));

import { GET, POST } from '@/app/api/plano-contas/route';
import { PATCH, DELETE } from '@/app/api/plano-contas/[id]/route';
import { ApiError } from '@/lib/api-error';

function reqGet(qs = '') {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/plano-contas${qs}`), { params: {} as Record<string, never> });
}

function reqPost(body: unknown, papel = 'admin') {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel });
  return POST(
    new Request('http://test/api/plano-contas', { method: 'POST', body: JSON.stringify(body) }),
    { params: {} as Record<string, never> },
  );
}

function reqPatch(id: string, body: unknown) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'admin' });
  const req = new Request(`http://test/api/plano-contas/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  return PATCH(req, { params: { id } });
}

function reqDelete(id: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'admin' });
  const req = new Request(`http://test/api/plano-contas/${id}`, { method: 'DELETE' });
  return DELETE(req, { params: { id } });
}

const CATEGORIA = { id: 'cat-1', grupo: 'despesa_operacional', nome: 'Despesas administrativas', sistema: false, ativo: true, ordem: 0, criadoEm: '2026-07-11T00:00:00Z' };

beforeEach(() => vi.clearAllMocks());

describe('GET /api/plano-contas', () => {
  it('lista categorias (admin ou financeiro)', async () => {
    mockListarCategorias.mockResolvedValue([CATEGORIA]);
    const res = await reqGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([CATEGORIA]);
  });

  it('repassa o filtro ativo da querystring', async () => {
    mockListarCategorias.mockResolvedValue([]);
    await reqGet('?ativo=true');
    expect(mockListarCategorias).toHaveBeenCalledWith({ ativo: true });
  });

  it('sem papel autorizado → erro propagado', async () => {
    mockRequireRole.mockRejectedValue(new ApiError(403, 'Sem permissão', 'FORBIDDEN'));
    const res = await GET(new Request('http://test/api/plano-contas'), { params: {} as Record<string, never> });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/plano-contas', () => {
  it('cria categoria (admin)', async () => {
    mockCriarCategoria.mockResolvedValue(CATEGORIA);
    const res = await reqPost({ grupo: 'despesa_operacional', nome: 'Despesas administrativas' });
    expect(res.status).toBe(201);
    expect(mockCriarCategoria).toHaveBeenCalledWith({ grupo: 'despesa_operacional', nome: 'Despesas administrativas' });
  });

  it('grupo fora da whitelist → 422', async () => {
    const res = await reqPost({ grupo: 'inventado', nome: 'x' });
    expect(res.status).toBe(422);
    expect(mockCriarCategoria).not.toHaveBeenCalled();
  });

  it('nome vazio → 422', async () => {
    const res = await reqPost({ grupo: 'receita', nome: '' });
    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/plano-contas/[id]', () => {
  it('atualiza nome/ordem', async () => {
    mockAtualizarCategoria.mockResolvedValue({ ...CATEGORIA, nome: 'Novo nome' });
    const res = await reqPatch('cat-1', { nome: 'Novo nome' });
    expect(res.status).toBe(200);
    expect(mockAtualizarCategoria).toHaveBeenCalledWith('cat-1', { nome: 'Novo nome', ordem: undefined });
    expect(mockDesativarCategoria).not.toHaveBeenCalled();
  });

  it('ativo:false chama desativarCategoria em vez de atualizarCategoria', async () => {
    mockDesativarCategoria.mockResolvedValue({ ...CATEGORIA, ativo: false });
    const res = await reqPatch('cat-1', { ativo: false });
    expect(res.status).toBe(200);
    expect(mockDesativarCategoria).toHaveBeenCalledWith('cat-1');
    expect(mockAtualizarCategoria).not.toHaveBeenCalled();
  });

  it('ativo:true é rejeitado pelo schema (só false é aceito)', async () => {
    const res = await reqPatch('cat-1', { ativo: true });
    expect(res.status).toBe(422);
  });

  it('corpo vazio (QA-921-1) → 422 claro, nunca bate no repository', async () => {
    const res = await reqPatch('cat-1', {});
    expect(res.status).toBe(422);
    expect(mockAtualizarCategoria).not.toHaveBeenCalled();
    expect(mockDesativarCategoria).not.toHaveBeenCalled();
  });

  it('desativar categoria de sistema propaga o 400 do repository', async () => {
    mockDesativarCategoria.mockRejectedValue(
      new ApiError(400, 'Categoria de sistema não pode ser desativada.', 'CATEGORIA_SISTEMA_PROTEGIDA'),
    );
    const res = await reqPatch('cat-sistema', { ativo: false });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('CATEGORIA_SISTEMA_PROTEGIDA');
  });
});

describe('DELETE /api/plano-contas/[id]', () => {
  it('exclui com sucesso → 204', async () => {
    mockExcluirCategoria.mockResolvedValue(undefined);
    const res = await reqDelete('cat-1');
    expect(res.status).toBe(204);
    expect(mockExcluirCategoria).toHaveBeenCalledWith('cat-1');
  });

  it('categoria em uso → 409 propagado', async () => {
    mockExcluirCategoria.mockRejectedValue(
      new ApiError(409, 'Categoria em uso. Desative em vez de excluir.', 'CATEGORIA_EM_USO'),
    );
    const res = await reqDelete('cat-1');
    expect(res.status).toBe(409);
  });

  it('categoria de sistema → 400 propagado', async () => {
    mockExcluirCategoria.mockRejectedValue(
      new ApiError(400, 'Categoria de sistema não pode ser excluída.', 'CATEGORIA_SISTEMA_PROTEGIDA'),
    );
    const res = await reqDelete('cat-sistema');
    expect(res.status).toBe(400);
  });
});
