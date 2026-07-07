// Testes do resolvedor de e-mail (Fase 4 — "Disparado por") — Admin Auth API mockada.
// Cobre o contrato "não-fatal": qualquer falha vira null/mapa vazio, nunca lança.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUserById = vi.fn();
const mockListUsers = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById: mockGetUserById, listUsers: mockListUsers } },
  }),
}));

import { resolverEmailPorId, resolverEmailsPorIds } from '@/server/auth/resolver-email';

beforeEach(() => vi.clearAllMocks());

describe('resolverEmailPorId', () => {
  it('devolve o e-mail quando a Admin API responde com sucesso', async () => {
    mockGetUserById.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null });
    await expect(resolverEmailPorId('u1')).resolves.toBe('a@b.com');
  });

  it('devolve null (não lança) quando a Admin API retorna erro', async () => {
    mockGetUserById.mockResolvedValue({ data: { user: null }, error: { message: 'boom' } });
    await expect(resolverEmailPorId('u1')).resolves.toBeNull();
  });

  it('devolve null (não lança) quando a Admin API lança exceção', async () => {
    mockGetUserById.mockRejectedValue(new Error('network down'));
    await expect(resolverEmailPorId('u1')).resolves.toBeNull();
  });
});

describe('resolverEmailsPorIds', () => {
  it('mapeia só os uuids pedidos, ignorando outros usuários da lista', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'u1', email: 'a@b.com' }, { id: 'u2', email: 'c@d.com' }] },
      error: null,
    });
    const map = await resolverEmailsPorIds(['u1']);
    expect(map.get('u1')).toBe('a@b.com');
    expect(map.has('u2')).toBe(false);
  });

  it('devolve mapa vazio sem chamar a API quando a lista de ids é vazia', async () => {
    const map = await resolverEmailsPorIds([]);
    expect(map.size).toBe(0);
    expect(mockListUsers).not.toHaveBeenCalled();
  });

  it('devolve mapa vazio (não lança) quando a Admin API falha', async () => {
    mockListUsers.mockRejectedValue(new Error('boom'));
    await expect(resolverEmailsPorIds(['u1'])).resolves.toEqual(new Map());
  });
});
