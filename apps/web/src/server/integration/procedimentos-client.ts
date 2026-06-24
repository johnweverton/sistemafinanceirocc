// Integration Client — único ponto que fala com GET /api/procedimentos da Carmem (PRD §6.4).
// Dois modos (espelha o LOCAL_FALLBACK do motor_guias_v2.py):
//   - 'local': lê de fixtures locais — a API real ainda não existe (PRD §11).
//   - 'http' : chama a API real com X-API-Key.
// A escolha vem de PROCEDIMENTOS_SOURCE. Isto NÃO é o Engine — pode fazer I/O.
//
// COMO LIGAR A API REAL (quando ela existir): basta `PROCEDIMENTOS_SOURCE=http` +
// preencher CARMEM_API_URL e CARMEM_API_KEY. Zero mudança de código esperada — só
// confirmar com o programador da Carmem os campos de CPF e data de emissão (PRD §11).
import type { Procedimento, PapelMedico } from '@cobranca/shared';
import { getServerEnv } from '@/lib/env';
import { ApiError } from '@/lib/api-error';
import { buscarProcedimentosLocal } from './fixtures-local';

const RETRY_MAX = 3;
const TIMEOUT_MS = 30_000;
const PAPEIS_VALIDOS: PapelMedico[] = ['M', 'A1', 'A2'];

/** Normaliza o objeto JSON cru da API para o tipo Procedimento (contrato PRD §6.4). */
export function normalizarProcedimento(obj: Record<string, unknown>): Procedimento {
  const s = (v: unknown): string => (v == null ? '' : String(v));
  const sn = (v: unknown): string | null => (v == null ? null : String(v));
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // tipo (papel): M / A1 / A2 — preservado p/ rastreabilidade, não filtra contagem (PRD §5.4).
  // Valor fora do domínio cai em 'M' para não quebrar a contagem (não é dado de cobrança).
  const tipoBruto = s(obj.tipo).toUpperCase() as PapelMedico;
  const tipo: PapelMedico = PAPEIS_VALIDOS.includes(tipoBruto) ? tipoBruto : 'M';

  return {
    // PRD §11: campo de CPF a confirmar com o programador — assumimos `cpf_medico` do contrato.
    cpfMedico: s(obj.cpf_medico),
    numeroAtendimento: s(obj.numero_atendimento),
    senhaProcedimento: s(obj.senha_procedimento),
    dataEmissao: s(obj.data_emissao).slice(0, 10), // AAAA-MM-DD
    dataProcedimento: s(obj.data_procedimento).slice(0, 10), // AAAA-MM-DD
    tipo,
    descricaoProcedimento: sn(obj.descricao_procedimento),
    codigoProcedimento: sn(obj.codigo_procedimento),
    valor: num(obj.valor),
    localAtendimento: sn(obj.local_atendimento),
    plano: sn(obj.plano),
  };
}

/** Monta a URL preservando qualquer path-base já presente em CARMEM_API_URL. */
function montarUrl(base: string, cpf: string, competencia: string): URL {
  const baseLimpa = base.endsWith('/') ? base.slice(0, -1) : base;
  const url = new URL(`${baseLimpa}/api/procedimentos`);
  url.searchParams.set('competencia', competencia);
  url.searchParams.set('cpf', cpf);
  return url;
}

async function buscarViaHttp(cpf: string, competencia: string): Promise<Procedimento[]> {
  const env = getServerEnv();
  if (!env.CARMEM_API_URL || !env.CARMEM_API_KEY) {
    throw new ApiError(500, 'API da Carmem não configurada (CARMEM_API_URL/CARMEM_API_KEY)', 'CONFIG');
  }
  const url = montarUrl(env.CARMEM_API_URL, cpf, competencia);

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= RETRY_MAX; tentativa++) {
    try {
      const resp = await fetch(url, {
        headers: { 'X-API-Key': env.CARMEM_API_KEY },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // 401 = chave ausente/inválida (PRD §6.4): não é transitório, falha imediata.
      if (resp.status === 401) {
        throw new ApiError(502, 'API da Carmem recusou a chave (401)', 'CARMEM_401');
      }
      // 4xx (exceto 401) = erro de cliente — também não é transitório, não adianta repetir.
      if (resp.status >= 400 && resp.status < 500) {
        throw new ApiError(502, `API da Carmem respondeu ${resp.status}`, 'CARMEM_CLIENT');
      }
      // 5xx = erro de servidor — transitório, deixa cair no retry.
      if (!resp.ok) {
        throw new RetryavelError(`API da Carmem respondeu ${resp.status}`);
      }

      const json = await resp.json();
      if (!Array.isArray(json)) {
        // 200 com corpo inesperado: não é dado de cobrança válido — falha sem retry.
        throw new ApiError(502, 'Resposta da API da Carmem não é um array', 'CARMEM_FORMATO');
      }
      // Array vazio é caminho válido (médico sem produção) → vira 'sem_dados' no Engine.
      return (json as Record<string, unknown>[]).map(normalizarProcedimento);
    } catch (e) {
      ultimoErro = e;
      // Erros não-transitórios (401, 4xx, formato) propagam de imediato.
      if (e instanceof ApiError) throw e;
      // Transitórios (rede, timeout, 5xx): backoff exponencial antes da próxima tentativa.
      if (tentativa < RETRY_MAX) {
        await esperar(200 * 2 ** (tentativa - 1)); // 200ms, 400ms
      }
    }
  }

  // Esgotou as tentativas: erro de infraestrutura. O Orchestrator transforma em alerta
  // do médico (não derruba o lote) — ver execucao-orchestrator.processarUmMedico.
  throw new ApiError(502, 'Falha ao buscar procedimentos após retries', 'CARMEM_RETRY', {
    error: String(ultimoErro),
  });
}

/** Marca um erro como transitório (rede/5xx/timeout) → elegível para retry. */
class RetryavelError extends Error {}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Busca os procedimentos de um médico numa competência.
 * Resposta vazia (array vazio) é caminho válido → mapeia para status 'sem_dados' (PRD §6.4).
 */
export async function buscarProcedimentos(
  cpf: string,
  competencia: string,
): Promise<Procedimento[]> {
  const { PROCEDIMENTOS_SOURCE } = getServerEnv();
  if (PROCEDIMENTOS_SOURCE === 'http') {
    return buscarViaHttp(cpf, competencia);
  }
  return buscarProcedimentosLocal(cpf, competencia);
}
