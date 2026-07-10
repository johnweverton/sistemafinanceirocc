// Testes de getCredenciaisConta (Story 7.1, AC 4/6): resolução por prefixo com
// fallback das CORA_* legadas para 'mc' — a garantia de regressão zero da MC.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getCredenciaisConta } from '@/lib/env';

// Snapshot/restauração de TODAS as vars CORA* para isolar cada caso (o ambiente do
// desenvolvedor pode ter credenciais reais no shell — nunca podem vazar pro teste).
const snapshot: Record<string, string | undefined> = {};

function limparVarsCora() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('CORA')) {
      if (!(key in snapshot)) snapshot[key] = process.env[key];
      delete process.env[key];
    }
  }
}

beforeEach(limparVarsCora);

afterAll(() => {
  for (const [key, valor] of Object.entries(snapshot)) {
    if (valor === undefined) delete process.env[key];
    else process.env[key] = valor;
  }
});

const LEGADAS = {
  CORA_CERT_BASE64: 'cert-legado',
  CORA_KEY_BASE64: 'key-legada',
  CORA_API_URL: 'https://api.cora.com.br',
  CORA_CLIENT_ID: 'client-legado',
  CORA_WEBHOOK_SECRET: 'segredo-legado-16ch',
};

describe('getCredenciaisConta — mc (fallback legado)', () => {
  it('resolve pela CORA_* legada quando não há prefixadas (deploy sem env nova = status quo)', () => {
    Object.assign(process.env, LEGADAS);
    const cred = getCredenciaisConta('mc');
    expect(cred.certBase64).toBe('cert-legado');
    expect(cred.keyBase64).toBe('key-legada');
    expect(cred.apiUrl).toBe('https://api.cora.com.br');
    expect(cred.clientId).toBe('client-legado');
    expect(cred.webhookSecret).toBe('segredo-legado-16ch');
  });

  it('prefixadas CORA_MC_* têm precedência sobre as legadas', () => {
    Object.assign(process.env, LEGADAS, {
      CORA_MC_CERT_BASE64: 'cert-mc',
      CORA_MC_KEY_BASE64: 'key-mc',
      CORA_MC_API_URL: 'https://api-mc.cora.com.br',
      CORA_MC_CLIENT_ID: 'client-mc',
      CORA_MC_WEBHOOK_SECRET: 'segredo-mc-16chars',
    });
    const cred = getCredenciaisConta('mc');
    expect(cred.certBase64).toBe('cert-mc');
    expect(cred.keyBase64).toBe('key-mc');
    expect(cred.apiUrl).toBe('https://api-mc.cora.com.br');
    expect(cred.clientId).toBe('client-mc');
    expect(cred.webhookSecret).toBe('segredo-mc-16chars');
  });

  it('sem nenhuma env → erro nomeando a conta e as vars (com alternativa legada)', () => {
    expect(() => getCredenciaisConta('mc')).toThrowError(/conta emissora 'mc'/);
    expect(() => getCredenciaisConta('mc')).toThrowError(/CORA_MC_CERT_BASE64 \(ou CORA_CERT_BASE64\)/);
  });
});

describe('getCredenciaisConta — cavalcante_viana (sem fallback)', () => {
  it('resolve pelas CORA_CV_*; webhookSecret null quando ausente (não bloqueia emissão)', () => {
    Object.assign(process.env, {
      CORA_CV_CERT_BASE64: 'cert-cv',
      CORA_CV_KEY_BASE64: 'key-cv',
      CORA_CV_API_URL: 'https://api-cv.cora.com.br',
      CORA_CV_CLIENT_ID: 'client-cv',
    });
    const cred = getCredenciaisConta('cavalcante_viana');
    expect(cred.certBase64).toBe('cert-cv');
    expect(cred.clientId).toBe('client-cv');
    expect(cred.webhookSecret).toBeNull();
  });

  it('legadas CORA_* NÃO valem para a CV (são exclusivas da mc)', () => {
    Object.assign(process.env, LEGADAS);
    expect(() => getCredenciaisConta('cavalcante_viana')).toThrowError(
      /conta emissora 'cavalcante_viana'/,
    );
  });

  it('erro lista SOMENTE as vars faltantes', () => {
    Object.assign(process.env, {
      CORA_CV_CERT_BASE64: 'cert-cv',
      CORA_CV_KEY_BASE64: 'key-cv',
    });
    try {
      getCredenciaisConta('cavalcante_viana');
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('CORA_CV_API_URL');
      expect(msg).toContain('CORA_CV_CLIENT_ID');
      expect(msg).not.toContain('CORA_CV_CERT_BASE64');
      expect(msg).not.toContain('CORA_CV_KEY_BASE64');
    }
  });
});
