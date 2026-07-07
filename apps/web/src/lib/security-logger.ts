// Security Logger — logging estruturado de eventos de segurança (Achado I-2).
// Centraliza o padrão de log para facilitar busca nos Vercel Logs e futura integração
// com Sentry/Axiom. Todos os eventos vão para console.warn/console.error em JSON.
//
// Padrão: { sec: true, event, severity, userId?, ip?, requestId?, ...extra }
// O campo `sec: true` permite filtrar eventos de segurança nos logs:
//   grep '"sec":true' nos Vercel Logs.

export type SecuritySeverity = 'info' | 'warn' | 'error' | 'critical';

export interface SecurityEvent {
  event: string;
  severity: SecuritySeverity;
  userId?: string | null;
  ip?: string | null;
  requestId?: string;
  [key: string]: unknown;
}

/** Extrai IP do request (X-Forwarded-For → primeiro IP, ou null). */
export function extractIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  // Em Vercel, x-real-ip é populado automaticamente.
  return req.headers.get('x-real-ip') ?? null;
}

/**
 * Emite evento de segurança em JSON estruturado.
 * Nível do console baseado na severidade:
 *   info  → console.info
 *   warn  → console.warn
 *   error/critical → console.error
 */
export function securityLog(event: SecurityEvent): void {
  const payload = {
    sec: true,
    ts: new Date().toISOString(),
    ...event,
  };
  const json = JSON.stringify(payload);

  switch (event.severity) {
    case 'info':
      console.info(json);
      break;
    case 'warn':
      console.warn(json);
      break;
    case 'error':
    case 'critical':
      console.error(json);
      break;
  }
}

// ---- Eventos pré-definidos para uso comum ----

/** Tentativa de acesso sem autenticação ou sem perfil válido. */
export function logAuthFailure(req: Request, reason: string, userId?: string | null): void {
  securityLog({
    event: 'AUTH_FAILURE',
    severity: 'warn',
    userId,
    ip: extractIp(req),
    reason,
    path: new URL(req.url).pathname,
  });
}

/** Tentativa de acesso a recurso sem permissão (papel insuficiente). */
export function logForbidden(req: Request, userId: string, papelAtual: string): void {
  securityLog({
    event: 'FORBIDDEN',
    severity: 'warn',
    userId,
    ip: extractIp(req),
    papelAtual,
    path: new URL(req.url).pathname,
  });
}

/** Rate limit atingido. */
export function logRateLimited(req: Request, userId: string | null, limiter: string): void {
  securityLog({
    event: 'RATE_LIMITED',
    severity: 'warn',
    userId,
    ip: extractIp(req),
    limiter,
    path: new URL(req.url).pathname,
  });
}

/** Evento de webhook recebido (info para auditoria). */
export function logWebhookReceived(source: string, eventType: string | null, deduped: boolean): void {
  securityLog({
    event: 'WEBHOOK_RECEIVED',
    severity: 'info',
    source,
    eventType,
    deduped,
  });
}

/** Erro interno em rota crítica. */
export function logSecurityError(event: string, error: unknown, extra?: Record<string, unknown>): void {
  securityLog({
    event,
    severity: 'error',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...extra,
  });
}
