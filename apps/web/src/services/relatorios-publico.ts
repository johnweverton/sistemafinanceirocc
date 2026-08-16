// Cliente do BI público de Relatórios (sem sessão) — a rota não usa withErrorHandler, então o
// 404 (token inválido/revogado/expirado) vem em texto puro, sem o envelope ApiErrorBody das
// rotas autenticadas. Não usa `apiFetch` (que assume sempre o envelope JSON de erro).
import type { RelatorioPublicoResposta } from '@cobranca/shared';

export class RelatorioPublicoIndisponivel extends Error {}

export const relatoriosPublicoService = {
  buscar: async (token: string, competencia?: string): Promise<RelatorioPublicoResposta> => {
    const qs = competencia ? `?competencia=${encodeURIComponent(competencia)}` : '';
    const res = await fetch(`/api/relatorios/publico/${encodeURIComponent(token)}${qs}`);
    if (res.status === 404) {
      throw new RelatorioPublicoIndisponivel('Link inválido, revogado ou expirado.');
    }
    if (!res.ok) {
      throw new RelatorioPublicoIndisponivel('Não foi possível carregar o relatório. Tente novamente em instantes.');
    }
    return res.json() as Promise<RelatorioPublicoResposta>;
  },
};

export const relatoriosPublicoQueryKeys = {
  resposta: (token: string, competencia?: string) => ['relatorios-publico', token, competencia ?? null] as const,
};
