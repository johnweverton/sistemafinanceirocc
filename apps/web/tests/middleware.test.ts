// Testes do middleware — bypass de sessão + rate limit dedicado para o BI público de
// Relatórios (Módulo de Relatórios). O gate de auth normal (redirect pra /login) já é coberto
// implicitamente pelo comportamento existente; aqui cobrimos só o desvio novo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

import { middleware } from '@/middleware';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: null } });
});

function req(path: string, ip = '203.0.113.5') {
  return new NextRequest(new Request(`http://test${path}`, { headers: { 'x-forwarded-for': ip } }));
}

describe('middleware — bypass do BI público de Relatórios', () => {
  it('não redireciona /relatorios/publico/[token] mesmo sem sessão', async () => {
    const res = await middleware(req('/relatorios/publico/tok-abc'));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
    // Continua protegido pelos headers de segurança (fica dentro do matcher).
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('não redireciona /api/relatorios/publico/[token] mesmo sem sessão', async () => {
    const res = await middleware(req('/api/relatorios/publico/tok-abc'));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });

  it('não chama getUser para a rota pública (nem tenta resolver sessão)', async () => {
    await middleware(req('/relatorios/publico/tok-abc'));
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('outras rotas continuam exigindo sessão (redirect pra /login)', async () => {
    const res = await middleware(req('/relatorios'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('aplica rate limit dedicado por IP na rota pública (429 após estourar o limite)', async () => {
    let ultima!: Awaited<ReturnType<typeof middleware>>;
    for (let i = 0; i < 61; i++) {
      ultima = await middleware(req('/relatorios/publico/tok-abc', '198.51.100.7'));
    }
    expect(ultima.status).toBe(429);
  });

  it('IPs diferentes têm contadores de rate limit independentes', async () => {
    for (let i = 0; i < 60; i++) {
      await middleware(req('/relatorios/publico/tok-abc', '198.51.100.8'));
    }
    const res = await middleware(req('/relatorios/publico/tok-abc', '198.51.100.9'));
    expect(res.status).not.toBe(429);
  });
});
