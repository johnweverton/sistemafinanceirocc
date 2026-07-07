// Cliente fetch das rotas internas. O browser nunca chama a API da Carmem direto.
import type { ApiErrorBody } from '@/lib/api-error';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
