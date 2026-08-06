// Cora Gateway — implementação real de BoletoGatewayPort com mTLS.
// Usa a API Banking da Cora (POST /v2/invoices) autenticada via certificado mTLS.
//
// O miolo mTLS (agent + token OAuth2 cacheado + fetch via node:https) vive em cora-http.ts
// (refactor REUSE da Story 8.1) — este módulo só monta payloads e interpreta respostas.
//   - Credenciais chegam INJETADAS no construtor (Story 7.2): POR CONTA EMISSORA
//     (MC / Cavalcante Viana), resolvidas por getCredenciaisConta. Uma instância = uma conta.
//   - Invoice criada via POST /v2/invoices com bearer token + mTLS e header
//     Idempotency-Key (UUID) obrigatório — sem ele/no path v1 a Cora responde 404
//     "/external/invoices Not Found" (confirmado em produção 2026-07-09).
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
import type { CredenciaisConta } from '@/lib/env';
import { getServerEnv } from '@/lib/env';
import { calcularVencimento } from './vencimento';
import { CoraHttpClient } from './cora-http';

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
 *
 * Unidades do contrato v2 (developers.cora.com.br, confirmado 2026-07-10):
 *   - fine.amount = valor FIXO em CENTAVOS (tem precedência!); fine.rate = percentual 0-100.
 *     Nossa config é percentual → SEMPRE rate. (Bug em produção: multa 2% virou R$ 0,02.)
 *   - interest.rate = percentual 0-100 (não existe interest.amount).
 *   - discount = { type: 'FIXED' | 'PERCENT', value } — percentual usa type PERCENT.
 *     descontoDias não tem campo equivalente no contrato v2; fica só no domínio.
 */
function montarPaymentTerms(condicoes: CondicoesEmissao): Record<string, unknown> {
  const terms: Record<string, unknown> = {
    due_date: calcularVencimento(condicoes.diasVencimento),
  };
  if (condicoes.multaPercent != null) {
    terms.fine = { rate: condicoes.multaPercent };
  }
  if (condicoes.jurosMesPercent != null) {
    terms.interest = { rate: condicoes.jurosMesPercent };
  }
  if (condicoes.descontoPercent != null) {
    terms.discount = { type: 'PERCENT', value: condicoes.descontoPercent };
  }
  return terms;
}

/**
 * Descrição do item de cobrança enviado à Cora — aparece no boleto/PIX gerado. Inclui a
 * quantidade de guias cobradas quando disponível (pedido do dono, 2026-08-06); resultados sem
 * produção de guias (ex.: cliente contábil) omitem o trecho em vez de mostrar "0 guias".
 */
function montarDescricaoServico(competencia: string, quantidadeGuias: number | null | undefined): string {
  const base = `Cobrança competência ${competencia}`;
  if (!quantidadeGuias || quantidadeGuias <= 0) return base;
  return `${base} — ${quantidadeGuias} guia${quantidadeGuias === 1 ? '' : 's'}`;
}

export class CoraGateway implements BoletoGatewayPort {
  private http: CoraHttpClient;

  /**
   * Credenciais injetadas por conta emissora (Story 7.2) — presença/erro amigável é
   * responsabilidade de getCredenciaisConta (nomeia conta e vars faltantes). Agent mTLS
   * e cache de token são por instância do CoraHttpClient, logo por conta: os tokens da
   * MC e da CV nunca se misturam.
   */
  constructor(credenciais: CredenciaisConta) {
    this.http = new CoraHttpClient(credenciais);
  }

  async emitir(dados: DadosEmissaoBoleto, idempotencyKey: string): Promise<EmissaoBoleto> {
    try {
      const token = await this.http.obterToken();

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

      const invoicePayload: Record<string, unknown> = {
        amount: Math.round(dados.valor * 100), // Cora usa centavos
        code: dados.execucaoResultadoId.slice(0, 20), // referência interna
        customer,
        payment_terms: montarPaymentTerms(condicoes),
        services: [
          {
            name: montarDescricaoServico(dados.competencia, dados.quantidadeGuias),
            amount: Math.round(dados.valor * 100),
          },
        ],
      };
      // Boleto híbrido (achado 2026-08-05): pago por código de barras custa R$1,70 na Cora,
      // pago por Pix (QR Code embutido no mesmo boleto) custa só R$0,50. Aditivo — o código de
      // barras continua funcionando igual, só ganha a opção extra de Pix. Exige chave Pix
      // cadastrada na conta emissora no painel da Cora.
      if (getServerEnv().EMISSAO_PIX_HABILITADA === 'true') {
        invoicePayload.payment_forms = ['BANK_SLIP', 'PIX'];
      }

      const invoiceUrl = `${this.http.baseUrl}/v2/invoices`;
      const resp = await this.http.fetch(invoiceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          // Obrigatório na API v2 — determinística por registro (não randomUUID() por
          // tentativa, migration 0037): reprocessar a MESMA reserva reusa a MESMA chave.
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(invoicePayload),
      });

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
   * Mesma convenção de path do consultarInvoice (baseUrl + /v2/invoices/{id}).
   * Erro nunca vira exceção solta — sucesso=false com payload cru para auditoria.
   */
  async cancelar(idExterno: string): Promise<ResultadoCancelamento> {
    try {
      const token = await this.http.obterToken();
      const url = `${this.http.baseUrl}/v2/invoices/${encodeURIComponent(idExterno)}`;
      const resp = await this.http.fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
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
      const token = await this.http.obterToken();
      const url = `${this.http.baseUrl}/v2/invoices/${encodeURIComponent(idExterno)}`;
      const resp = await this.http.fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
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
// criarAgentMtls/fetchMtls moram em cora-http.ts desde a Story 8.1 (re-export p/ compat).
export { criarAgentMtls, fetchMtls } from './cora-http';
export { calcularVencimento, montarPaymentTerms, montarDescricaoServico, normalizarStatusInvoice };
