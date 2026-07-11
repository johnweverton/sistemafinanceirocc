// Client HTTP comum da Cora (refactor REUSE, Story 8.1) — miolo mTLS extraído de
// cora-gateway.ts SEM mudança de comportamento: agent mTLS, token OAuth2 com cache por
// instância e fetch via node:https. Consumido por CoraGateway (boletos) e CoraContaGateway
// (extrato/saldo). Uma instância = uma conta emissora: os tokens da MC e da CV nunca se
// misturam (mesma garantia da Story 7.2).
//
// Fluxo mTLS da Cora (documentação oficial):
//   1. Certificado e chave privada chegam INJETADOS no construtor: as credenciais são POR
//      CONTA EMISSORA e resolvidas por getCredenciaisConta — este módulo não lê env.
//   2. Token OAuth2 obtido via POST /token com client_credentials + mTLS.
import type { CredenciaisConta } from '@/lib/env';
import https from 'node:https';

/** Decodifica base64 de env var para Buffer (PEM). */
function decodificarBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/** Cria um https.Agent com certificado e chave mTLS. */
export function criarAgentMtls(certBase64: string, keyBase64: string): https.Agent {
  return new https.Agent({
    cert: decodificarBase64(certBase64),
    key: decodificarBase64(keyBase64),
    // Rejeita servidores com certificado inválido (produção).
    rejectUnauthorized: true,
  });
}

/** Faz fetch com mTLS via dispatcher do Node.js (undici, embutido no Node 18+). */
export async function fetchMtls(
  url: string,
  options: RequestInit & { agent?: https.Agent },
  agent: https.Agent,
): Promise<Response> {
  // Node.js 18+ com undici: fetch global aceita 'dispatcher' em runtime,
  // mas para mTLS precisamos do módulo https nativo. Usamos a abordagem com
  // node:https request convertido para Response-like.
  return new Promise<Response>((resolve, reject) => {
    const parsedUrl = new URL(url);
    const postData = options.body ? String(options.body) : undefined;
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method ?? 'POST',
        headers: {
          ...(options.headers as Record<string, string>),
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData).toString() } : {}),
        },
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const status = res.statusCode ?? 500;
            // O construtor Response PROÍBE corpo (mesmo '') em status null-body — o DELETE
            // /v2/invoices da Cora devolve 204 e isso derrubava o processo inteiro na Vercel
            // (uncaught exception fora da Promise → rota presa → timeout 300s → exit 129).
            const semCorpo = status === 204 || status === 205 || status === 304;
            resolve(
              new Response(semCorpo ? null : body, {
                status,
                statusText: res.statusMessage ?? '',
                headers: res.headers as Record<string, string>,
              }),
            );
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
    );
    req.on('error', reject);
    // Timeout de 10s POR CHAMADA: uma operação encadeia até 3 round-trips mTLS (token →
    // reconsulta → DELETE) e o total precisa caber no maxDuration da function na Vercel;
    // com 30s cada, a cadeia podia estourar o orçamento e a function morria no meio.
    req.setTimeout(10_000, () => {
      req.destroy(new Error('Timeout mTLS request'));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

interface CoraTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Client autenticado da Cora para UMA conta emissora: agent mTLS + cache de token por
 * instância + fetch com mTLS. Os gateways compõem este client em vez de duplicar o miolo.
 */
export class CoraHttpClient {
  readonly baseUrl: string;
  private agent: https.Agent;
  private clientId: string;

  // Achado M-5: cache de token OAuth2 em memória — evita chamada a /token a cada operação.
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(credenciais: CredenciaisConta) {
    this.agent = criarAgentMtls(credenciais.certBase64, credenciais.keyBase64);
    this.baseUrl = credenciais.apiUrl.replace(/\/$/, '');
    this.clientId = credenciais.clientId;
  }

  /** Invalida o token cacheado (chamado quando uma request recebe 401 da Cora). */
  invalidarToken(): void {
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Obtém token OAuth2 via client_credentials com mTLS (documentação Cora).
   * Achado M-5: cacheia o token por (expires_in - 60s) para evitar chamadas redundantes.
   */
  async obterToken(): Promise<string> {
    // Retorna cache se ainda válido (margem de 60s antes da expiração real).
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const tokenUrl = `${this.baseUrl}/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
    }).toString();

    const resp = await this.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Cora token error ${resp.status}: ${errBody}`);
    }

    const json = (await resp.json()) as CoraTokenResponse;

    // Cachear com margem de segurança: expira 60s antes do real para evitar uso de token expirado.
    const ttlMs = Math.max((json.expires_in - 60) * 1000, 0);
    this.cachedToken = json.access_token;
    this.tokenExpiresAt = Date.now() + ttlMs;

    return json.access_token;
  }

  /** Fetch com o agent mTLS desta conta. */
  async fetch(url: string, options: RequestInit): Promise<Response> {
    return fetchMtls(url, options, this.agent);
  }
}
