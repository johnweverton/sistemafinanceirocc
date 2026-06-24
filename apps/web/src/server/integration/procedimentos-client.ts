// Integration Client — único ponto que fala com GET /api/procedimentos da Carmem.
// Dois modos (espelha o LOCAL_FALLBACK do motor_guias_v2.py):
//   - 'local': lê de fixtures locais (Fase 1 — a API real ainda não existe, PRD §11).
//   - 'http' : chama a API real com X-API-Key (Fase 2).
// A escolha vem de PROCEDIMENTOS_SOURCE. Isto NÃO é o Engine — pode fazer I/O.
import type { Procedimento } from '@cobranca/shared';
import { getServerEnv } from '@/lib/env';
import { ApiError } from '@/lib/api-error';
import { buscarProcedimentosLocal } from './fixtures-local';

const RETRY_MAX = 3;

/** Normaliza o objeto JSON cru da API para o tipo Procedimento (contrato PRD §6.4). */
function normalizarProcedimento(obj: Record<string, unknown>): Procedimento {
  const s = (v: unknown): string => (v == null ? '' : String(v));
  const sn = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    // PRD §11: campo de CPF a confirmar com o programador — assumimos `cpf_medico` do contrato.
    cpfMedico: s(obj.cpf_medico),
    numeroAtendimento: s(obj.numero_atendimento),
    senhaProcedimento: s(obj.senha_procedimento),
    dataEmissao: s(obj.data_emissao).slice(0, 10),
    dataProcedimento: s(obj.data_procedimento).slice(0, 10),
    tipo: (obj.tipo as Procedimento['tipo']) ?? 'M',
    descricaoProcedimento: sn(obj.descricao_procedimento),
    codigoProcedimento: sn(obj.codigo_procedimento),
    valor: obj.valor == null ? null : Number(obj.valor),
    localAtendimento: sn(obj.local_atendimento),
    plano: sn(obj.plano),
  };
}

async function buscarViaHttp(cpf: string, competencia: string): Promise<Procedimento[]> {
  const env = getServerEnv();
  if (!env.CARMEM_API_URL || !env.CARMEM_API_KEY) {
    throw new ApiError(500, 'API da Carmem não configurada (CARMEM_API_URL/CARMEM_API_KEY)', 'CONFIG');
  }
  const url = new URL('/api/procedimentos', env.CARMEM_API_URL);
  url.searchParams.set('competencia', competencia);
  url.searchParams.set('cpf', cpf);

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= RETRY_MAX; tentativa++) {
    try {
      const resp = await fetch(url, {
        headers: { 'X-API-Key': env.CARMEM_API_KEY },
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.status === 401) throw new ApiError(502, 'API da Carmem recusou a chave (401)', 'CARMEM_401');
      if (!resp.ok) throw new ApiError(502, `API da Carmem respondeu ${resp.status}`, 'CARMEM_HTTP');
      const json = (await resp.json()) as Record<string, unknown>[];
      return json.map(normalizarProcedimento);
    } catch (e) {
      ultimoErro = e;
      if (e instanceof ApiError && e.code === 'CARMEM_401') throw e; // 401 não é transitório
      // backoff exponencial simples: 200ms, 400ms, 800ms
      if (tentativa < RETRY_MAX) {
        await new Promise((r) => setTimeout(r, 200 * 2 ** (tentativa - 1)));
      }
    }
  }
  throw new ApiError(502, 'Falha ao buscar procedimentos após retries', 'CARMEM_RETRY', {
    error: String(ultimoErro),
  });
}

/**
 * Busca os procedimentos de um médico numa competência.
 * Resposta vazia (array vazio) é caminho válido → mapeia para status 'sem_dados'.
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
