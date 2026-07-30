import type { ContaEmissora, GrupoPlanoContas, LancamentoManual, TipoLancamentoManual } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';

export interface CategoriaRelatorio {
  categoriaId: string;
  nome: string;
  grupo: GrupoPlanoContas;
  total: number;
}

/** Resposta do GET /dre/relatorio — os 4 totais já são os subtotais por grupo (D4). */
export interface RelatorioDre {
  porCategoria: CategoriaRelatorio[];
  totalReceitas: number;
  totalDeducoes: number;
  totalDespesasOperacionais: number;
  totalDespesasFinanceiras: number;
  resultadoLiquido: number;
}

export interface FiltroRelatorio {
  inicio: string;
  fim: string;
  /** Ausente = consolidado (MC + CV). */
  conta?: ContaEmissora;
}

interface CriarLancamentoBase {
  contaEmissora: ContaEmissora;
  categoriaId: string;
  descricao: string;
  valor: number;
}

export type CriarLancamentoInput =
  | (CriarLancamentoBase & { tipoLancamento: 'avulso'; data: string })
  | (CriarLancamentoBase & {
      tipoLancamento: 'recorrente';
      diaDoMes: number;
      dataInicio: string;
      dataFim?: string | null;
    });

export const dreService = {
  relatorio: (filtro: FiltroRelatorio) => {
    const qs = new URLSearchParams({ inicio: filtro.inicio, fim: filtro.fim });
    if (filtro.conta) qs.set('conta', filtro.conta);
    return apiFetch<RelatorioDre>(`/dre/relatorio?${qs.toString()}`);
  },
  listarLancamentos: (conta?: ContaEmissora, tipo?: TipoLancamentoManual) => {
    const qs = new URLSearchParams();
    if (conta) qs.set('conta', conta);
    if (tipo) qs.set('tipo', tipo);
    const query = qs.toString();
    return apiFetch<LancamentoManual[]>(`/dre/lancamentos${query ? `?${query}` : ''}`);
  },
  criarLancamento: (input: CriarLancamentoInput) =>
    apiFetch<LancamentoManual>('/dre/lancamentos', { method: 'POST', body: JSON.stringify(input) }),
  excluirLancamento: (id: string) => apiFetch<void>(`/dre/lancamentos/${id}`, { method: 'DELETE' }),
};

export const dreQueryKeys = {
  relatorio: (filtro: FiltroRelatorio) => ['dre', 'relatorio', filtro] as const,
  lancamentos: (conta?: ContaEmissora, tipo?: TipoLancamentoManual) =>
    ['dre', 'lancamentos', conta, tipo] as const,
};
