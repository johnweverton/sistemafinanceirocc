// Cliente das rotas de máquina do Sistema Financeiro (Story 13.1): só /api/integracoes/iss/*, com
// o token dedicado. O agente não tem service role nem sessão de usuário (arquitetura D2).
// Story 13.5: + as rotas de solicitações (próxima, progresso, concluir) do modo vigiar/agendado.
import type {
  AlvosIssResposta,
  ConclusaoSolicitacaoIss,
  ExecucaoIssRegistrada,
  NovaExecucaoIss,
  SolicitacaoIss,
} from '@cobranca/shared';

export class ErroApi extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = 'ErroApi';
  }
}

async function chamar<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new ErroApi(`Sem resposta do sistema (${(e as Error).message})`, null);
  }
  const corpo = await res.text();
  if (!res.ok) {
    let msg = corpo.slice(0, 500);
    try {
      const j = JSON.parse(corpo) as { error?: { message?: string; details?: unknown } };
      msg = `${j.error?.message ?? msg}${j.error?.details ? ` ${JSON.stringify(j.error.details)}` : ''}`;
    } catch {
      /* corpo não-JSON: usa o texto cru */
    }
    const dica = res.status === 401 ? ' — confira AGENTE_ISS_TOKEN (e AGENTE_ISS_TOKEN_SHA256 na Vercel)' : '';
    throw new ErroApi(`Sistema respondeu ${res.status}: ${msg}${dica}`, res.status);
  }
  // 204 (ex.: "nenhuma solicitação a processar", Story 13.5) não tem corpo.
  if (res.status === 204 || corpo.trim() === '') return null as T;
  return JSON.parse(corpo) as T;
}

export function buscarAlvos(sistemaUrl: string, token: string, competencia: string): Promise<AlvosIssResposta> {
  return chamar(`${sistemaUrl}/api/integracoes/iss/alvos?competencia=${encodeURIComponent(competencia)}`, token);
}

export function enviarExecucao(sistemaUrl: string, token: string, execucao: NovaExecucaoIss): Promise<ExecucaoIssRegistrada> {
  return chamar(`${sistemaUrl}/api/integracoes/iss/execucoes`, token, {
    method: 'POST',
    body: JSON.stringify(execucao),
  });
}

/**
 * Story 13.5 (AC 10): reivindica a próxima solicitação feita pelo sistema web. `null` = nada a
 * fazer (204). O servidor já a devolve `em_andamento` e em nome desta máquina.
 */
export function buscarProximaSolicitacao(sistemaUrl: string, token: string, maquina: string): Promise<SolicitacaoIss | null> {
  return chamar<SolicitacaoIss | null>(
    `${sistemaUrl}/api/integracoes/iss/solicitacoes/proxima?maquina=${encodeURIComponent(maquina)}`,
    token,
  );
}

/** Story 13.5 (AC 11): "N de total" — também é o sinal de vida (heartbeat) da solicitação. */
export async function enviarProgresso(
  sistemaUrl: string,
  token: string,
  solicitacaoId: string,
  atual: number,
  total: number,
): Promise<void> {
  await chamar(`${sistemaUrl}/api/integracoes/iss/solicitacoes/${encodeURIComponent(solicitacaoId)}/progresso`, token, {
    method: 'POST',
    body: JSON.stringify({ atual, total }),
  });
}

/** Story 13.5 (AC 12): `{ execucaoId }` ⇒ concluída; `{ erro }` ⇒ falhou. */
export async function concluirSolicitacao(
  sistemaUrl: string,
  token: string,
  solicitacaoId: string,
  conclusao: ConclusaoSolicitacaoIss,
): Promise<void> {
  await chamar(`${sistemaUrl}/api/integracoes/iss/solicitacoes/${encodeURIComponent(solicitacaoId)}/concluir`, token, {
    method: 'POST',
    body: JSON.stringify(conclusao),
  });
}
