// Testes do resolvedor de e-mail (Fase 4 — "Disparado por") — Admin Auth API mockada.
// Cobre o contrato "não-fatal": qualquer falha vira null/mapa vazio, nunca lança.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUserById = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById: mockGetUserById } },
  }),
}));

import { resolverEmailPorId, resolverEmailsPorIds } from '@/server/auth/resolver-email';

beforeEach(() => vi.clearAllMocks());

describe('resolverEmailPorId', () => {
  it('devolve o e-mail quando a Admin API responde com sucesso', async () => {
    mockGetUserById.mockResolvedValueOnce({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null });
    await expect(resolverEmailPorId('u1')).resolves.toBe('a@b.com');
  });

  it('devolve null (não lança) quando a Admin API retorna erro', async () => {
    mockGetUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'boom' } });
    await expect(resolverEmailPorId('u2')).resolves.toBeNull();
  });

  it('devolve null (não lança) quando a Admin API lança exceção', async () => {
    mockGetUserById.mockRejectedValueOnce(new Error('network down'));
    await expect(resolverEmailPorId('u3')).resolves.toBeNull();
  });
});

describe('resolverEmailsPorIds', () => {
  it('resolve múltiplos uuids em chamadas individuais (agora com getUserById)', async () => {
    mockGetUserById.mockImplementation(async (id: string) => {
      if (id === 'u4') return { data: { user: { id: 'u4', email: 'a@b.com' } }, error: null };
      if (id === 'u5') return { data: { user: { id: 'u5', email: 'c@d.com' } }, error: null };
      return { data: { user: null }, error: null };
    });
    const map = await resolverEmailsPorIds(['u4', 'u5']);
    expect(map.get('u4')).toBe('a@b.com');
    expect(map.get('u5')).toBe('c@d.com');
    expect(mockGetUserById).toHaveBeenCalledTimes(2);
  });

  it('devolve mapa vazio sem chamar a API quando a lista de ids é vazia', async () => {
    const map = await resolverEmailsPorIds([]);
    expect(map.size).toBe(0);
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('devolve mapa com null (não lança) quando a Admin API falha', async () => {
    mockGetUserById.mockRejectedValueOnce(new Error('boom'));
    const map = await resolverEmailsPorIds(['u6']);
    expect(map.get('u6')).toBeNull();
  });
});

