import type { ContaEmissora, RelatorioRecebiveis, RelatorioLink, CriarRelatorioLinkInput } from '@cobranca/shared';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { ApiErrorBody } from '@/lib/api-error';

export interface FiltroRelatorio {
  competencia?: string;
  conta?: ContaEmissora;
}

function qs(filtros: FiltroRelatorio): string {
  const params = new URLSearchParams();
  if (filtros.competencia) params.set('competencia', filtros.competencia);
  if (filtros.conta) params.set('conta', filtros.conta);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Baixa um arquivo binário de uma rota interna — resposta não é JSON, não usa `apiFetch`. */
async function baixarArquivo(path: string): Promise<Blob> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* corpo não-JSON */
    }
    throw new ApiClientError(
      res.status,
      body?.error?.message ?? `Erro ${res.status}`,
      body?.error?.code ?? 'ERROR',
      body?.error?.details,
    );
  }
  return res.blob();
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
