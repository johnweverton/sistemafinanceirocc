import { ApiClientError } from '@/lib/api-client';
import type { ApiErrorBody } from '@/lib/api-error';

/** Baixa um arquivo binário de uma rota interna — resposta não é JSON, não usa `apiFetch`.
 *  Extraído de `services/relatorios.ts` (achado 2026-09-04) pra ser reaproveitado por qualquer
 *  serviço que exporte arquivo (Excel/PDF/etc). */
export async function baixarArquivo(path: string): Promise<Blob> {
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

/** Dispara o download de um `Blob` já em mãos, via link temporário — extraído de
 *  `RelatoriosManager.tsx` (achado 2026-09-04) pra ser reaproveitado por qualquer botão de
 *  exportação. */
export function baixarBlob(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
