// Rate limiter in-memory para rotas de escrita (Achado I-1).
// Implementação sliding window sem dependência externa — usa Map com cleanup automático.
// Adequado para uso serverless (Vercel): cada cold start reseta o estado, e o rate limit
// opera como proteção contra bursts dentro de uma mesma instância. Para rate limiting
// distribuído (multi-região), evoluir para Redis/Upstash no futuro.

/** Configuração do rate limiter. */
export interface RateLimitConfig {
  /** Número máximo de requisições permitidas na janela. */
  limit: number;
  /** Duração da janela em milissegundos. */
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

// Cleanup periódico para evitar vazamento de memória (a cada 60s, remove entradas expiradas).
let cleanupScheduled = false;
function scheduleCleanup(): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setTimeout(() => {
    const now = Date.now();
    for (const [, store] of stores) {
      for (const [key, entry] of store) {
        if (now > entry.resetAt) store.delete(key);
      }
    }
    cleanupScheduled = false;
  }, 60_000).unref?.(); // .unref() evita manter o processo vivo só por este timer
}

/**
 * Cria um rate limiter para uma rota ou grupo de rotas.
 *
 * @param name - Nome único do rate limiter (ex.: 'boletos-emitir').
 * @param config - Limites e janela temporal.
 * @returns Função que recebe a chave de identificação (userId ou IP) e retorna se permitido.
 *
 * Uso em Route Handler:
 * ```ts
 * const limiter = createRateLimiter('boletos-emitir', { limit: 10, windowMs: 60_000 });
 *
 * export const POST = withErrorHandler(async (req) => {
 *   const sessao = await requireRole(['admin']);
 *   checkRateLimit(limiter, sessao.userId, 'Emissão de boleto');
 *   // ... lógica da rota
 * });
 * ```
 */
export function createRateLimiter(name: string, config: RateLimitConfig) {
  if (!stores.has(name)) stores.set(name, new Map());
  return { name, config };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Verifica se a chave (userId ou IP) está dentro do limite. Retorna detalhes.
 */
export function checkLimit(
  limiter: ReturnType<typeof createRateLimiter>,
  key: string,
): RateLimitResult {
  const store = stores.get(limiter.name)!;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // Janela expirada ou primeira requisição: iniciar nova janela.
    store.set(key, { count: 1, resetAt: now + limiter.config.windowMs });
    scheduleCleanup();
    return { allowed: true, remaining: limiter.config.limit - 1, resetAt: now + limiter.config.windowMs };
  }

  entry.count += 1;
  const allowed = entry.count <= limiter.config.limit;
  return {
    allowed,
    remaining: Math.max(0, limiter.config.limit - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Wrapper prático: verifica o limite e lança ApiError 429 se excedido.
 * Importar ApiError inline para evitar dependência circular (rate-limit é usado por api-error's wrapper).
 */
export function assertRateLimit(
  limiter: ReturnType<typeof createRateLimiter>,
  key: string,
  operacao: string,
): void {
  const result = checkLimit(limiter, key);
  if (!result.allowed) {
    // Import dinâmico evitado: usamos throw manual com status 429.
    const retryAfterSec = Math.ceil((result.resetAt - Date.now()) / 1000);
    const err = new Error(
      `Limite de requisições excedido para ${operacao}. Tente novamente em ${retryAfterSec}s.`,
    );
    (err as any).status = 429;
    (err as any).code = 'RATE_LIMITED';
    (err as any).details = { retryAfterSec, remaining: result.remaining };
    throw err;
  }
}
