// Cora Conta Gateway — implementação real de ContaBancariaPort (Épico 8, Story 8.1).
// LEITURA bancária por conta emissora: extrato (GET /bank-statement/statement, paginado)
// e saldo (GET /third-party/account/balance). Compõe o CoraHttpClient (miolo mTLS comum
// com o CoraGateway) — uma instância = uma conta, tokens isolados.
//
// Pegadinhas do contrato (pesquisa 2026-07-10, docs/research/…-cora-apis-integracao-direta):
//   - start/end SEMPRE `YYYY-MM-DD` — formato errado devolve 500 na Cora; validamos ANTES
//     de qualquer chamada de rede.
//   - amount vem em CENTAVOS — conversão para reais aqui na borda (padrão do projeto).
//   - A entrada NÃO referencia o invoice_id do boleto — o vínculo é do matching (8.2).
// Erro NUNCA vira exceção solta: resultado tipado { sucesso: false, erro } (padrão
// consultarInvoice).
import type {
  ContaBancariaPort,
  FiltroExtrato,
  ResultadoExtrato,
  ResultadoSaldo,
  TransacaoExtratoApi,
} from '@cobranca/shared';
import type { CredenciaisConta } from '@/lib/env';
import { CoraHttpClient } from './cora-http';

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const PER_PAGE = 500; // máximo documentado da API
// Guarda contra loop infinito se a API repetir páginas: 40 × 500 = 20k entradas,
// ordens de grandeza acima do volume esperado (~centenas/mês).
const MAX_PAGINAS = 40;

/**
 * Normaliza uma entrada do extrato para o tipo de domínio (reais, campos achatados).
 * Entrada sem os campos mínimos (id/type/amount/createdAt) é descartada — o payload cru
 * das demais segue para auditoria. Shape da resposta (pesquisa §1): entries[] com
 * { id, type, amount, createdAt, transaction { type, description, counterParty { name, identity } } }.
 */
function normalizarEntry(entry: unknown): TransacaoExtratoApi | null {
  const e = (entry ?? {}) as Record<string, unknown>;
  const tx = (e.transaction ?? {}) as Record<string, unknown>;
  const cp = (tx.counterParty ?? {}) as Record<string, unknown>;

  const entryId = typeof e.id === 'string' && e.id ? e.id : null;
  const tipoRaw = String(e.type ?? '').toUpperCase();
  const tipo = tipoRaw === 'CREDIT' || tipoRaw === 'DEBIT' ? tipoRaw : null;
  const centavos = typeof e.amount === 'number' ? e.amount : null;
  const dataTransacao = typeof e.createdAt === 'string' && e.createdAt ? e.createdAt : null;
  if (!entryId || !tipo || centavos == null || !dataTransacao) return null;

  const documento = typeof cp.identity === 'string' ? cp.identity.replace(/\D/g, '') : '';
  return {
    entryId,
    tipo,
    transactionType: typeof tx.type === 'string' && tx.type ? tx.type : null,
    valor: centavos / 100,
    descricao: typeof tx.description === 'string' && tx.description ? tx.description : null,
    contraparteNome: typeof cp.name === 'string' && cp.name ? cp.name : null,
    contraparteDocumento: documento || null,
    dataTransacao,
    payload: entry,
  };
}

/**
 * Normaliza a resposta do saldo. Campos assumidos (padrão normalizarStatusInvoice — ajuste
 * único quando o formato real for confirmado no stage): available/amount/balance em centavos,
 * blocked em centavos quando presente.
 */
function normalizarSaldo(body: unknown): { disponivel: number; bloqueado: number | null } | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const centavos =
    typeof b.available === 'number' ? b.available
    : typeof b.amount === 'number' ? b.amount
    : typeof b.balance === 'number' ? b.balance
    : null;
  if (centavos == null) return null;
  return {
    disponivel: centavos / 100,
    bloqueado: typeof b.blocked === 'number' ? b.blocked / 100 : null,
  };
}

export class CoraContaGateway implements ContaBancariaPort {
  private http: CoraHttpClient;

  constructor(credenciais: CredenciaisConta) {
    this.http = new CoraHttpClient(credenciais);
  }

  async consultarExtrato(filtros: FiltroExtrato): Promise<ResultadoExtrato> {
    // Valida ANTES de qualquer rede: data fora de YYYY-MM-DD devolve 500 na Cora.
    if (!FORMATO_DATA.test(filtros.inicio) || !FORMATO_DATA.test(filtros.fim)) {
      return {
        sucesso: false,
        erro: `Período inválido: datas devem ser YYYY-MM-DD (recebido '${filtros.inicio}' a '${filtros.fim}')`,
      };
    }
    try {
      const token = await this.http.obterToken();
      const transacoes: TransacaoExtratoApi[] = [];

      for (let page = 1; page <= MAX_PAGINAS; page++) {
        const params = new URLSearchParams({
          start: filtros.inicio,
          end: filtros.fim,
          page: String(page),
          perPage: String(PER_PAGE),
        });
        const url = `${this.http.baseUrl}/bank-statement/statement?${params.toString()}`;
        const resp = await this.http.fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          return { sucesso: false, erro: `Cora extrato: HTTP ${resp.status} na página ${page}` };
        }
        const body = (await resp.json()) as Record<string, unknown>;
        const entries = Array.isArray(body.entries) ? body.entries : [];
        for (const entry of entries) {
          const t = normalizarEntry(entry);
          if (t) transacoes.push(t);
        }
        // Página incompleta = acabou; página cheia pode ter continuação.
        if (entries.length < PER_PAGE) break;
      }

      return { sucesso: true, transacoes };
    } catch (error) {
      return { sucesso: false, erro: error instanceof Error ? error.message : String(error) };
    }
  }

  async consultarSaldo(): Promise<ResultadoSaldo> {
    try {
      const token = await this.http.obterToken();
      const url = `${this.http.baseUrl}/third-party/account/balance`;
      const resp = await this.http.fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        return { sucesso: false, erro: `Cora saldo: HTTP ${resp.status}` };
      }
      const saldo = normalizarSaldo(await resp.json());
      if (!saldo) {
        return { sucesso: false, erro: 'Cora saldo: resposta sem campo de valor reconhecível' };
      }
      return {
        sucesso: true,
        saldo: { ...saldo, consultadoEm: new Date().toISOString() },
      };
    } catch (error) {
      return { sucesso: false, erro: error instanceof Error ? error.message : String(error) };
    }
  }
}

// Exporta os normalizadores para testes unitários.
export { normalizarEntry, normalizarSaldo };
