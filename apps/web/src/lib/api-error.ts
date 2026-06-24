// Erro de sistema padronizado para as rotas internas (architecture: Error Handling).
// Alertas de NEGÓCIO não usam isto — são valores retornados (ExecucaoResultado.alertas).
// Só falhas de infraestrutura/validação viram ApiError.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = 'ERROR',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
    requestId: string;
  };
}

type RouteCtx<P> = { params: P };
type RouteHandler<P> = (req: Request, ctx: RouteCtx<P>) => Promise<Response>;

/** Envolve um handler convertendo exceções em resposta JSON padronizada. */
export function withErrorHandler<P = Record<string, never>>(
  handler: RouteHandler<P>,
): RouteHandler<P> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      const requestId = crypto.randomUUID();
      const status = e instanceof ApiError ? e.status : 500;
      const code = e instanceof ApiError ? e.code : 'INTERNAL';
      const message = e instanceof Error ? e.message : 'Erro interno';
      console.error(JSON.stringify({ requestId, status, code, error: String(e) }));
      const body: ApiErrorBody = {
        error: {
          code,
          message: status === 500 ? 'Erro interno' : message,
          details: e instanceof ApiError ? e.details : undefined,
          timestamp: new Date().toISOString(),
          requestId,
        },
      };
      return Response.json(body, { status });
    }
  };
}
