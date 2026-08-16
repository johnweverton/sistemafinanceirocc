// Testes unitários do relatorio-links-repository (Módulo de Relatórios) — mock do Supabase admin.
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface EstadoFake {
  links: Map<string, Record<string, unknown>>;
  atualizados: Record<string, unknown>[];
}

function novoEstado(): EstadoFake {
  return { links: new Map(), atualizados: [] };
}

let estado = novoEstado();

function linkRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'link-1',
    token: 'token-fake',
    nome: 'BI da CEO',
    escopo_conta_emissora: null,
    criado_por: 'user-1',
    criado_em: '2026-08-01T00:00:00Z',
    expira_em: null,
    revogado_em: null,
    ultimo_acesso_em: null,
    ...overrides,
  };
}

vi.mock('../../../src/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => {
      if (table !== 'relatorio_links') throw new Error(`tabela não mockada no teste: ${table}`);
      return {
        select: vi.fn(() => ({
          order: vi.fn(async () => ({ data: Array.from(estado.links.values()), error: null })),
          eq: vi.fn((_col: string, token: string) => ({
            maybeSingle: vi.fn(async () => {
              const encontrado = Array.from(estado.links.values()).find((l) => l.token === token) ?? null;
              return { data: encontrado, error: null };
            }),
          })),
        })),
        insert: vi.fn((row: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              const novo = linkRow({ ...row, id: 'link-novo' });
              estado.links.set('link-novo', novo);
              return { data: novo, error: null };
            }),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => ({
          eq: vi.fn(async (_col: string, id: string) => {
            estado.atualizados.push({ id, ...patch });
            const atual = estado.links.get(id);
            if (atual) estado.links.set(id, { ...atual, ...patch });
            return { error: null };
          }),
        })),
      };
    }),
  }),
}));

import {
  criarLink,
  listarLinks,
  revogarLink,
  buscarLinkValidoPorToken,
  registrarAcesso,
} from '../../../src/server/repositories/relatorio-links-repository';

beforeEach(() => {
  estado = novoEstado();
});

describe('criarLink', () => {
  it('cria com token de alta entropia (256 bits em base64url)', async () => {
    const link = await criarLink('user-1', { nome: 'BI da CEO' });
    expect(link.nome).toBe('BI da CEO');
    expect(link.criadoPor).toBe('user-1');
    // base64url de 32 bytes -> 43 chars sem padding
    expect(link.token.length).toBeGreaterThanOrEqual(42);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('gera tokens diferentes a cada chamada', async () => {
    const a = await criarLink('user-1', { nome: 'A' });
    const b = await criarLink('user-1', { nome: 'B' });
    expect(a.token).not.toBe(b.token);
  });
});

describe('listarLinks', () => {
  it('lista os links mapeados', async () => {
    estado.links.set('link-1', linkRow());
    const links = await listarLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: 'link-1', nome: 'BI da CEO' });
  });
});

describe('revogarLink', () => {
  it('seta revogado_em', async () => {
    estado.links.set('link-1', linkRow());
    await revogarLink('link-1');
    expect(estado.atualizados[0]).toMatchObject({ id: 'link-1' });
    expect(estado.atualizados[0]!.revogado_em).toBeDefined();
  });
});

describe('buscarLinkValidoPorToken', () => {
  it('retorna o link quando token existe, não revogado e não expirado', async () => {
    estado.links.set('link-1', linkRow({ token: 'abc' }));
    const link = await buscarLinkValidoPorToken('abc');
    expect(link).toMatchObject({ id: 'link-1', token: 'abc' });
  });

  it('retorna null para token inexistente', async () => {
    const link = await buscarLinkValidoPorToken('nao-existe');
    expect(link).toBeNull();
  });

  it('retorna null para link revogado', async () => {
    estado.links.set('link-1', linkRow({ token: 'abc', revogado_em: '2026-08-01T00:00:00Z' }));
    const link = await buscarLinkValidoPorToken('abc');
    expect(link).toBeNull();
  });

  it('retorna null para link expirado', async () => {
    estado.links.set('link-1', linkRow({ token: 'abc', expira_em: '2020-01-01T00:00:00Z' }));
    const link = await buscarLinkValidoPorToken('abc');
    expect(link).toBeNull();
  });

  it('aceita link com expiração futura', async () => {
    estado.links.set('link-1', linkRow({ token: 'abc', expira_em: '2099-01-01T00:00:00Z' }));
    const link = await buscarLinkValidoPorToken('abc');
    expect(link).not.toBeNull();
  });
});

describe('registrarAcesso', () => {
  it('atualiza ultimo_acesso_em/ip', async () => {
    estado.links.set('link-1', linkRow());
    await registrarAcesso('link-1', '203.0.113.9');
    expect(estado.atualizados[0]).toMatchObject({ id: 'link-1', ultimo_acesso_ip: '203.0.113.9' });
  });
});
