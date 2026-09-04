import type { ContaEmissora, TipoServico, RelatorioRecebiveis, RelatorioLink, CriarRelatorioLinkInput } from '@cobranca/shared';
import { apiFetch } from '@/lib/api-client';
import { baixarArquivo } from '@/lib/baixar-arquivo';

export interface FiltroRelatorio {
  competencia?: string;
  conta?: ContaEmissora;
  tipoServico?: TipoServico;
}

function qs(filtros: FiltroRelatorio): string {
  const params = new URLSearchParams();
  if (filtros.competencia) params.set('competencia', filtros.competencia);
  if (filtros.conta) params.set('conta', filtros.conta);
  if (filtros.tipoServico) params.set('tipoServico', filtros.tipoServico);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const relatoriosService = {
  preview: (filtros: FiltroRelatorio) => apiFetch<RelatorioRecebiveis>(`/relatorios/recebiveis${qs(filtros)}`),
  exportarExcel: (filtros: FiltroRelatorio) => baixarArquivo(`/relatorios/recebiveis/exportar-excel${qs(filtros)}`),
  exportarPdf: (filtros: FiltroRelatorio) => baixarArquivo(`/relatorios/recebiveis/exportar-pdf${qs(filtros)}`),
  links: {
    listar: () => apiFetch<RelatorioLink[]>('/relatorios/links'),
    criar: (input: CriarRelatorioLinkInput) =>
      apiFetch<RelatorioLink>('/relatorios/links', { method: 'POST', body: JSON.stringify(input) }),
    revogar: (id: string) => apiFetch<void>(`/relatorios/links/${id}/revogar`, { method: 'POST' }),
  },
};

export const relatoriosQueryKeys = {
  preview: (filtros: FiltroRelatorio) => ['relatorios', 'preview', filtros] as const,
  links: () => ['relatorios', 'links'] as const,
};
