// Testes das rotas GET/POST /api/relatorios/links e POST /api/relatorios/links/[id]/revogar
// (gestão do link público do BI, Módulo de Relatórios).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockCriarLink = vi.fn();
const mockListarLinks = vi.fn();
const mockRevogarLink = vi.fn();
vi.mock('@/server/repositories/relatorio-links-repository', () => ({
  criarLink: (...a: unknown[]) => mockCriarLink(...a),
  listarLinks: (...a: unknown[]) => mockListarLinks(...a),
  revogarLink: (...a: unknown[]) => mockRevogarLink(...a),
}));

import { GET, POST } from '@/app/api/relatorios/links/route';
import { POST as POST_REVOGAR } from '@/app/api/relatorios/links/[id]/revogar/route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/relatorios/links', () => {
  it('exige papel admin/financeiro e lista os links', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
    mockListarLinks.mockResolvedValue([{ id: 'link-1', nome: 'BI da CEO' }]);
    const res = await GET(new Request('http://test/api/relatorios/links'), { params: {} as Record<string, never> });
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});

describe('POST /api/relatorios/links', () => {
  function reqPost(payload: unknown) {
    mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
    return POST(
      new Request('http://test/api/relatorios/links', { method: 'POST', body: JSON.stringify(payload) }),
      { params: {} as Record<string, never> },
    );
  }

  it('nome vazio → 422, não cria link', async () => {
    const res = await reqPost({ nome: '' });
    expect(res.status).toBe(422);
    expect(mockCriarLink).not.toHaveBeenCalled();
  });

  it('escopo de empresa inválido → 422', async () => {
    const res = await reqPost({ nome: 'BI da CEO', escopoContaEmissora: 'banco-invalido' });
    expect(res.status).toBe(422);
  });

  it('cria o link e devolve 201 com o token', async () => {
    mockCriarLink.mockResolvedValue({ id: 'link-1', nome: 'BI da CEO', token: 'tok-abc' });
    const res = await reqPost({ nome: 'BI da CEO' });
    expect(res.status).toBe(201);
    expect(mockCriarLink).toHaveBeenCalledWith('u1', { nome: 'BI da CEO' });
    const body = await res.json();
    expect(body.token).toBe('tok-abc');
  });
});

describe('POST /api/relatorios/links/[id]/revogar', () => {
  it('exige papel admin/financeiro e revoga o link', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'admin' });
    const res = await POST_REVOGAR(new Request('http://test/api/relatorios/links/link-1/revogar', { method: 'POST' }), {
      params: { id: 'link-1' },
    });
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
    expect(mockRevogarLink).toHaveBeenCalledWith('link-1');
    expect(res.status).toBe(204);
  });
});
