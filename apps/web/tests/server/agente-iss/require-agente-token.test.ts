// Autenticação das rotas de máquina do agente ISS (Story 13.1, AC 4): bearer comparado por
// SHA-256 com AGENTE_ISS_TOKEN_SHA256, fail-closed sem a env.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const TOKEN = 'a'.repeat(64);
const mockEnv: { AGENTE_ISS_TOKEN_SHA256?: string } = {};
vi.mock('@/lib/env', () => ({ getServerEnv: vi.fn(() => ({ ...mockEnv })) }));

import { requireAgenteIssToken } from '@/server/auth/require-agente-token';

function req(auth?: string) {
  const headers = new Headers();
  if (auth !== undefined) headers.set('authorization', auth);
  return new Request('http://test/api/integracoes/iss/alvos', { headers });
}

beforeEach(() => {
  mockEnv.AGENTE_ISS_TOKEN_SHA256 = createHash('sha256').update(TOKEN).digest('hex');
});

describe('requireAgenteIssToken', () => {
  it('token correto passa', () => {
    expect(() => requireAgenteIssToken(req(`Bearer ${TOKEN}`))).not.toThrow();
  });

  it('hash configurado em maiúsculas também vale', () => {
    mockEnv.AGENTE_ISS_TOKEN_SHA256 = mockEnv.AGENTE_ISS_TOKEN_SHA256!.toUpperCase();
    expect(() => requireAgenteIssToken(req(`Bearer ${TOKEN}`))).not.toThrow();
  });

  it.each([
    ['sem header', undefined],
    ['token errado', 'Bearer outro-token-qualquer'],
    ['esquema errado', `Basic ${TOKEN}`],
    ['bearer vazio', 'Bearer '],
  ])('%s → 401', (_nome, auth) => {
    expect(() => requireAgenteIssToken(req(auth))).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('enviar o próprio HASH como token não autentica', () => {
    expect(() => requireAgenteIssToken(req(`Bearer ${mockEnv.AGENTE_ISS_TOKEN_SHA256}`))).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('sem AGENTE_ISS_TOKEN_SHA256 → sempre 401 (fail-closed)', () => {
    delete mockEnv.AGENTE_ISS_TOKEN_SHA256;
    expect(() => requireAgenteIssToken(req(`Bearer ${TOKEN}`))).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });
});
