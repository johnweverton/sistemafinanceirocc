// Erro de sistema padronizado para as rotas internas (architecture: Error Handling).
// Alertas de NEGÓCIO não usam isto — são valores retornados (ExecucaoResultado.alertas).
// Só falhas de infraestrutura/validação viram ApiError.
import {
  logAuthFailure,
  logForbidden,
  logRateLimited,
  logSecurityError,
} from './security-logger';

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
      const status = e instanceof ApiError ? e.status : ((e as any).status ?? 500);
      const code = e instanceof ApiError ? e.code : ((e as any).code ?? 'INTERNAL');
      const message = e instanceof Error ? e.message : 'Erro interno';
      
      // Achado I-2: Logging estruturado de segurança
      const isApiErr = e instanceof ApiError;
      if (status === 401) {
        logAuthFailure(req, message);
      } else if (status === 403) {
        logForbidden(req, 'Desconhecido', code);
      } else if (status === 429) {
        logRateLimited(req, null, (e as any).limiter ?? 'API');
      } else if (status === 500) {
        logSecurityError('API_ERROR', e, { path: new URL(req.url).pathname, requestId });
      } else {
        // Log info para outros erros (400, 422, etc)
        console.info(JSON.stringify({ sec: true, event: 'API_CLIENT_ERROR', status, code, requestId, path: new URL(req.url).pathname }));
      }
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
