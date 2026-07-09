// Cora Gateway — implementação real de BoletoGatewayPort com mTLS.
// Usa a API Banking da Cora (POST /invoices) autenticada via certificado mTLS.
//
// Fluxo mTLS da Cora (documentação oficial):
//   1. Certificado e chave privada são carregados de env vars base64.
//   2. Token OAuth2 obtido via POST /token com client_credentials + mTLS.
//   3. Invoice criada via POST /invoices com o bearer token + mTLS.
//
// Sem certificado real, este gateway não funciona — o mock-gateway.ts é o fallback.
import type {
  BoletoGatewayPort,
  DadosEmissaoBoleto,
  EmissaoBoleto,
  CondicoesEmissao,
  StatusInvoice,
  ResultadoCancelamento,
} from '@cobranca/shared';
import { getServerEnv } from '@/lib/env';
import { calcularVencimento } from './vencimento';
import https from 'node:https';

/**
 * Normaliza a resposta do `GET /invoices/{id}` da Cora para `StatusInvoice`. Isolada para permitir
 * ajuste único quando o formato real da API for confirmado (campos assumidos: status/paid_at/
 * total_paid). Status desconhecido → 'unknown' (não dá baixa).
 */
function normalizarStatusInvoice(body: unknown): StatusInvoice {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = String(b.status ?? '').toUpperCase();
  const status: StatusInvoice['status'] =
    raw === 'PAID' ? 'paid'
    : raw === 'CANCELLED' || raw === 'CANCELED' ? 'canceled'
    : raw === 'OVERDUE' || raw === 'LATE' ? 'overdue'
    : raw === 'OPEN' || raw === 'PENDING' ? 'open'
    : 'unknown';
  const centavos = typeof b.total_paid === 'number' ? b.total_paid : null;
  return {
    status,
    valorPago: centavos != null ? centavos / 100 : null,
    pagoEm: typeof b.paid_at === 'string' ? b.paid_at : null,
  };
}

/**
 * Monta o bloco payment_terms do Cora a partir das condições resolvidas.
 * Multa/juros/desconto só entram quando têm valor (omitidos quando nulos).
 */
function montarPaymentTerms(condicoes: CondicoesEmissao): Record<string, unknown> {
  const terms: Record<string, unknown> = {
    due_date: calcularVencimento(condicoes.diasVencimento),
  };
  if (condicoes.multaPercent != null) {
    terms.fine = { amount: condicoes.multaPercent };
  }
  if (condicoes.jurosMesPercent != null) {
    terms.interest = { rate: condicoes.jurosMesPercent };
  }
  if (condicoes.descontoPercent != null) {
    terms.discount = {
      amount: condicoes.descontoPercent,
      ...(condicoes.descontoDias != null ? { days: condicoes.descontoDias } : {}),
    };
  }
  return terms;
}

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

  // Achado M-5: cache de token OAuth2 em memória — evita chamada a /token a cada operação.
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

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

  /** Invalida o token cacheado (chamado quando uma request recebe 401 da Cora). */
  private invalidarToken(): void {
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Obtém token OAuth2 via client_credentials com mTLS (documentação Cora).
   * Achado M-5: cacheia o token por (expires_in - 60s) para evitar chamadas redundantes.
   */
  private async obterToken(): Promise<string> {
    // Retorna cache se ainda válido (margem de 60s antes da expiração real).
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

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

    // Cachear com margem de segurança: expira 60s antes do real para evitar uso de token expirado.
    const ttlMs = Math.max((json.expires_in - 60) * 1000, 0);
    this.cachedToken = json.access_token;
    this.tokenExpiresAt = Date.now() + ttlMs;

    return json.access_token;
  }

  async emitir(dados: DadosEmissaoBoleto): Promise<EmissaoBoleto> {
    try {
      const token = await this.obterToken();

      // Monta o payload conforme o contrato POST /invoices da Cora.
      const { pagador, condicoes } = dados;

      // E-mail e endereço são opcionais (Épico 6) — a Cora não exige pra emitir boleto
      // registrado. Endereço é tudo-ou-nada: só entra no payload se vier completo
      // (garantido por enderecoCompletoOuAusente na rota); nunca manda objeto parcial.
      const customer: Record<string, unknown> = {
        name: pagador.nome,
        document: {
          identity: pagador.documento.replace(/\D/g, ''),
          type: pagador.tipo, // 'CPF' | 'CNPJ' dinâmico
        },
      };
      if (pagador.email) customer.email = pagador.email;
      if (pagador.endereco) {
        customer.address = {
          street: pagador.endereco.logradouro,
          number: pagador.endereco.numero,
          district: pagador.endereco.bairro,
          city: pagador.endereco.cidade,
          state: pagador.endereco.uf,
          complement: pagador.endereco.complemento ?? undefined,
          zip_code: pagador.endereco.cep,
        };
      }

      const invoicePayload = {
        amount: Math.round(dados.valor * 100), // Cora usa centavos
        code: dados.execucaoResultadoId.slice(0, 20), // referência interna
        customer,
        payment_terms: montarPaymentTerms(condicoes),
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

  /**
   * Cancela uma invoice em aberto (Story 6.1). Contrato confirmado na documentação oficial
   * (developers.cora.com.br, 2026-07-08): DELETE /v2/invoices/{id} com Bearer + mTLS → 200 em
   * sucesso; só boletos NÃO pagos podem ser cancelados (pago → erro da Cora → sucesso=false).
   * Mesma convenção de path do consultarInvoice (baseUrl + /invoices/{id}).
   * Erro nunca vira exceção solta — sucesso=false com payload cru para auditoria.
   */
  async cancelar(idExterno: string): Promise<ResultadoCancelamento> {
    try {
      const token = await this.obterToken();
      const url = `${this.baseUrl}/invoices/${encodeURIComponent(idExterno)}`;
      const resp = await fetchMtls(
        url,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        this.agent,
      );
      // Corpo pode ser vazio (200/204) — lê como texto e tenta JSON.
      const texto = await resp.text();
      let body: unknown = null;
      try {
        body = texto ? JSON.parse(texto) : null;
      } catch {
        body = texto;
      }
      if (resp.ok) {
        return { sucesso: true, payloadResposta: body };
      }
      return { sucesso: false, payloadResposta: { httpStatus: resp.status, body } };
    } catch (error) {
      return {
        sucesso: false,
        payloadResposta: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /** Consulta o status real de uma invoice (fonte da verdade da conciliação). Erro/404 → 'unknown'. */
  async consultarInvoice(idExterno: string): Promise<StatusInvoice> {
    try {
      const token = await this.obterToken();
      const url = `${this.baseUrl}/invoices/${encodeURIComponent(idExterno)}`;
      const resp = await fetchMtls(
        url,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        this.agent,
      );
      if (!resp.ok) {
        return { status: 'unknown', valorPago: null, pagoEm: null };
      }
      return normalizarStatusInvoice(await resp.json());
    } catch {
      return { status: 'unknown', valorPago: null, pagoEm: null };
    }
  }
}

// Exporta também as funções internas para testes unitários com mocks.
export { criarAgentMtls, fetchMtls, calcularVencimento, montarPaymentTerms, normalizarStatusInvoice };
