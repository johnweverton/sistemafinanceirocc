// Cora Gateway — implementação real de BoletoGatewayPort com mTLS.
// Usa a API Banking da Cora (POST /invoices) autenticada via certificado mTLS.
//
// Fluxo mTLS da Cora (documentação oficial):
//   1. Certificado e chave privada são carregados de env vars base64.
//   2. Token OAuth2 obtido via POST /token com client_credentials + mTLS.
//   3. Invoice criada via POST /invoices com o bearer token + mTLS.
//
// Sem certificado real, este gateway não funciona — o mock-gateway.ts é o fallback.
import type { BoletoGatewayPort, DadosEmissaoBoleto, EmissaoBoleto } from '@cobranca/shared';
import { getServerEnv } from '@/lib/env';
import https from 'node:https';

/** Decodifica base64 de env var para Buffer (PEM). */
function decodificarBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/** Cria um https.Agent com certificado e chave mTLS. */
function criarAgentMtls(certBase64: string, keyBase64: string): https.Agent {
  return new https.Agent({
    cert: decodificarBase64(certBase64),
    key: decodificarBase64(keyBase64),
    // Rejeita servidores com certificado inválido (produção).
    rejectUnauthorized: true,
  });
}

/** Faz fetch com mTLS via dispatcher do Node.js (undici, embutido no Node 18+). */
async function fetchMtls(
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
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(
            new Response(body, {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage ?? '',
              headers: res.headers as Record<string, string>,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    // Timeout de 30s.
    req.setTimeout(30_000, () => {
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

export class CoraGateway implements BoletoGatewayPort {
  private agent: https.Agent;
  private baseUrl: string;
  private clientId: string;

  constructor() {
    const env = getServerEnv();
    if (!env.CORA_CERT_BASE64 || !env.CORA_KEY_BASE64) {
      throw new Error(
        'Certificado mTLS da Cora não configurado (CORA_CERT_BASE64 / CORA_KEY_BASE64). ' +
          'Pendência externa: solicitar à Cora.',
      );
    }
    if (!env.CORA_API_URL) {
      throw new Error('CORA_API_URL não configurada.');
    }
    if (!env.CORA_CLIENT_ID) {
      throw new Error('CORA_CLIENT_ID não configurado.');
    }
    this.agent = criarAgentMtls(env.CORA_CERT_BASE64, env.CORA_KEY_BASE64);
    this.baseUrl = env.CORA_API_URL.replace(/\/$/, '');
    this.clientId = env.CORA_CLIENT_ID;
  }

  /** Obtém token OAuth2 via client_credentials com mTLS (documentação Cora). */
  private async obterToken(): Promise<string> {
    const tokenUrl = `${this.baseUrl}/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
    }).toString();

    const resp = await fetchMtls(
      tokenUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      this.agent,
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Cora token error ${resp.status}: ${errBody}`);
    }

    const json = (await resp.json()) as CoraTokenResponse;
    return json.access_token;
  }

  async emitir(dados: DadosEmissaoBoleto): Promise<EmissaoBoleto> {
    try {
      const token = await this.obterToken();

      // Monta o payload conforme o contrato POST /invoices da Cora.
      // Vencimento: 30 dias a partir de agora (padrão do escritório).
      const vencimento = new Date();
      vencimento.setDate(vencimento.getDate() + 30);

      const invoicePayload = {
        amount: Math.round(dados.valor * 100), // Cora usa centavos
        code: dados.execucaoResultadoId.slice(0, 20), // referência interna
        customer: {
          name: dados.nomeMedico,
          document: {
            identity: dados.cpfMedico.replace(/\D/g, ''),
            type: 'CPF',
          },
        },
        payment_terms: {
          due_date: vencimento.toISOString().slice(0, 10), // AAAA-MM-DD
        },
        services: [
          {
            name: `Cobrança competência ${dados.competencia}`,
            amount: Math.round(dados.valor * 100),
          },
        ],
      };

      const invoiceUrl = `${this.baseUrl}/invoices`;
      const resp = await fetchMtls(
        invoiceUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(invoicePayload),
        },
        this.agent,
      );

      const responseBody = await resp.json();

      if (!resp.ok) {
        return {
          idExterno: '',
          status: 'falha',
          payloadResposta: {
            httpStatus: resp.status,
            body: responseBody,
          },
        };
      }

      return {
        idExterno: (responseBody as { id?: string }).id ?? '',
        status: 'emitido',
        payloadResposta: responseBody,
      };
    } catch (error) {
      return {
        idExterno: '',
        status: 'falha',
        payloadResposta: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

// Exporta também as funções internas para testes unitários com mocks.
export { criarAgentMtls, fetchMtls };
