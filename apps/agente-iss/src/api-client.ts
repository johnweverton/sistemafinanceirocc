// Cliente das rotas de máquina do Sistema Financeiro (Story 13.1): só estas duas, com o token
// dedicado. O agente não tem service role nem sessão de usuário (arquitetura D2).
import type { AlvosIssResposta, ExecucaoIssRegistrada, NovaExecucaoIss } from '@cobranca/shared';

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
