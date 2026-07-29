// Fin API Client — único ponto que fala com a API REAL do Sistema Web (Épico 5, arquitetura §5.1).
// Contrato: docs/integracao/api-financeiro-sistema-web.md
//   GET /api/fin-clientes                → médicos da origem (sem especialidade)
//   GET /api/fin-producoes?clienteId=    → produções nomeadas de um médico
//   GET /api/fin-itens?producaoId=       → itens de uma produção
// Dois modos via FIN_API_SOURCE (espelha o desenho do procedimentos-client):
//   - 'local': fixtures em memória (dev/teste)
//   - 'http' : API real com header x-api-key
// Isto NÃO é o Engine — pode fazer I/O. Padrões de resiliência herdados do client
// anterior (calibrados): timeout 30s, retry ×3 com backoff SÓ para 5xx/rede.
import type { ClienteExterno, ProducaoExterna, ItemProducao } from '@cobranca/shared';
import { getServerEnv } from '@/lib/env';
import { ApiError } from '@/lib/api-error';
import {
  listarClientesLocal,
  listarProducoesLocal,
  buscarItensLocal,
} from './fixtures-local';

const RETRY_MAX = 3;
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Normalização defensiva (contrato cru → tipos do domínio)
// ---------------------------------------------------------------------------
const s = (v: unknown): string => (v == null ? '' : String(v));
const sn = (v: unknown): string | null => {
  if (v == null) return null;
  const str = String(v).trim();
  return str === '' ? null : str;
};
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// CPF: a doc do contrato promete "somente dígitos", mas a origem já entregou formatado
// (ex.: "010.508.863-30") — normaliza sempre, nunca confia no formato cru (isso quebrava
// a validação de 11 dígitos no formulário de médico).
const cpfDigitos = (v: unknown): string | null => {
  const str = sn(v);
  if (str == null) return null;
  const digitos = str.replace(/\D/g, '');
  return digitos === '' ? null : digitos;
};

export function toClienteExterno(obj: Record<string, unknown>): ClienteExterno {
  return {
    id: s(obj.id),
    nome: s(obj.name),
    cpf: cpfDigitos(obj.cpf),
    productionType: s(obj.production_type),
  };
}

export function toProducaoExterna(obj: Record<string, unknown>): ProducaoExterna {
  return {
    id: s(obj.id),
    nome: s(obj.name),
  };
}

export function toItemProducao(obj: Record<string, unknown>): ItemProducao {
  return {
    data: s(obj.date).slice(0, 10), // YYYY-MM-DD
    pacienteNome: s(obj.patient_name),
    // Senha da guia/autorização — campo `password` no contrato real; mantém fallback para
    // os nomes alternativos discutidos antes da entrega (arquitetura §3.2/§10.3).
    atendimentoExternoId: sn(obj.password ?? obj.senha ?? obj.numero_atendimento),
    codigoProcedimento: s(obj.proc_code),
    descricaoProcedimento: sn(obj.proc_name),
    statusOrigem: s(obj.status), // informativo — NUNCA filtra contagem (decisão 5)
    viaAcesso: obj.via_acesso === 'Sim',
    tipoAto: sn(obj.act_type),
    valorCobradoOrigem: num(obj.charged_val),
    valorPagoOrigem: num(obj.paid_val),
  };
}

// ---------------------------------------------------------------------------
// HTTP com retry (compartilhado pelos 3 endpoints)
// ---------------------------------------------------------------------------

/** Marca um erro como transitório (rede/5xx/timeout) → elegível para retry. */
class RetryavelError extends Error {}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Monta a URL preservando qualquer path-base já presente em API_FINANCEIRO_URL. */
function montarUrl(base: string, path: string, params: Record<string, string>): URL {
  const baseLimpa = base.endsWith('/') ? base.slice(0, -1) : base;
  const url = new URL(`${baseLimpa}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/**
 * GET autenticado que devolve um array cru. Erros:
 *   401 → FIN_API_401 (sem retry) · 4xx (exceto 401/429) → FIN_API_CLIENT (sem retry)
 *   corpo não-array → FIN_API_FORMATO (sem retry) · 429/5xx/rede → retry ×3 → FIN_API_RETRY
 * Array vazio é caminho VÁLIDO (ex.: médico sem produções).
 */
async function fetchArray(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const env = getServerEnv();
  if (!env.API_FINANCEIRO_URL || !env.API_FINANCEIRO_KEY) {
    throw new ApiError(
      500,
      'API do sistema web não configurada (API_FINANCEIRO_URL/API_FINANCEIRO_KEY)',
      'CONFIG',
    );
  }
  const url = montarUrl(env.API_FINANCEIRO_URL, path, params);

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= RETRY_MAX; tentativa++) {
    try {
      const resp = await fetch(url, {
        headers: { 'x-api-key': env.API_FINANCEIRO_KEY },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // 401 = chave ausente/inválida: não é transitório, falha imediata.
      if (resp.status === 401) {
        throw new ApiError(502, 'API do sistema web recusou a chave (401)', 'FIN_API_401');
      }
      // 429 = rate limit — transitório (mais provável sob a concorrência do processamento em
      // lote), deixa cair no retry com backoff em vez de falhar de imediato.
      if (resp.status === 429) {
        throw new RetryavelError(`API do sistema web respondeu ${resp.status}`);
      }
      // 4xx (exceto 401/429) = erro de cliente — não adianta repetir.
      if (resp.status >= 400 && resp.status < 500) {
        throw new ApiError(502, `API do sistema web respondeu ${resp.status}`, 'FIN_API_CLIENT');
      }
      // 5xx = erro de servidor — transitório, deixa cair no retry.
      if (!resp.ok) {
        throw new RetryavelError(`API do sistema web respondeu ${resp.status}`);
      }

      const json = await resp.json();
      if (!Array.isArray(json)) {
        throw new ApiError(502, 'Resposta da API do sistema web não é um array', 'FIN_API_FORMATO');
      }
      return json as Record<string, unknown>[];
    } catch (e) {
      ultimoErro = e;
      // Erros não-transitórios (401, 4xx, formato, config) propagam de imediato.
      if (e instanceof ApiError) throw e;
      // Transitórios (rede, timeout, 5xx): backoff exponencial antes da próxima tentativa.
      if (tentativa < RETRY_MAX) {
        await esperar(200 * 2 ** (tentativa - 1)); // 200ms, 400ms
      }
    }
  }

  // Esgotou as tentativas: erro de infraestrutura. Quem chama decide se vira alerta
  // (execução, por médico) ou erro de rota (sincronização).
  throw new ApiError(502, 'Falha ao consultar a API do sistema web após retries', 'FIN_API_RETRY', {
    error: String(ultimoErro),
  });
}

// ---------------------------------------------------------------------------
// API pública do client
// ---------------------------------------------------------------------------

/** Lista os médicos cadastrados na origem (GET /api/fin-clientes). */
export async function listarClientes(): Promise<ClienteExterno[]> {
  if (getServerEnv().FIN_API_SOURCE !== 'http') return listarClientesLocal();
  const rows = await fetchArray('/api/fin-clientes', {});
  return rows.map(toClienteExterno);
}

/** Lista as produções de um médico da origem (GET /api/fin-producoes?clienteId=). */
export async function listarProducoes(clienteExternoId: string): Promise<ProducaoExterna[]> {
  if (getServerEnv().FIN_API_SOURCE !== 'http') return listarProducoesLocal(clienteExternoId);
  const rows = await fetchArray('/api/fin-producoes', { clienteId: clienteExternoId });
  return rows.map(toProducaoExterna);
}

/**
 * Busca os itens de uma produção (GET /api/fin-itens?producaoId=).
 * Array vazio é caminho válido → vira 'sem_dados' no fluxo de execução.
 */
export async function buscarItens(producaoExternaId: string): Promise<ItemProducao[]> {
  if (getServerEnv().FIN_API_SOURCE !== 'http') return buscarItensLocal(producaoExternaId);
  const rows = await fetchArray('/api/fin-itens', { producaoId: producaoExternaId });
  return rows.map(toItemProducao);
}
