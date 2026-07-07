// Resolve uuid de profile → e-mail via Admin Auth API do Supabase (auth.users não é exposto via
// PostgREST). `profiles` não guarda nome/e-mail (só papel/colaborador_responsavel), então esta é a
// única fonte. Uso não-fatal: se a Admin API falhar, a tela que chamou continua funcionando sem o
// e-mail do autor (fallback null) — nunca deixamos essa resolução quebrar a listagem de execuções.
//
// Achado M-4: substituído listUsers() por getUserById() individual com cache de 5 min,
// evitando buscar TODOS os usuários (risco de DoS por memória se signup estiver aberto).
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Cache simples em memória: evita chamadas repetidas à Admin API para o mesmo userId.
// TTL de 5 minutos (e-mail não muda com frequência). Cleanup automático via tamanho.
const emailCache = new Map<string, { email: string | null; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const CACHE_MAX_SIZE = 200; // universo de usuários internos é pequeno

function getFromCache(userId: string): string | null | undefined {
  const entry = emailCache.get(userId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    emailCache.delete(userId);
    return undefined;
  }
  return entry.email;
}

function setCache(userId: string, email: string | null): void {
  // Evitar crescimento ilimitado (mesmo que improvável com poucos usuários internos).
  if (emailCache.size >= CACHE_MAX_SIZE) {
    const oldest = emailCache.keys().next().value;
    if (oldest) emailCache.delete(oldest);
  }
  emailCache.set(userId, { email, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Resolve um único uuid — usado no relatório de uma execução (ProgressoExecucao). */
export async function resolverEmailPorId(userId: string): Promise<string | null> {
  const cached = getFromCache(userId);
  if (cached !== undefined) return cached;
  try {
    const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(userId);
    const email = error ? null : (data.user?.email ?? null);
    setCache(userId, email);
    return email;
  } catch {
    return null;
  }
}

/**
 * Resolve vários uuids de uma vez — usado na lista de execuções, para não fazer N chamadas.
 * Achado M-4: agora usa getUserById() individual com cache, em vez de listUsers() que
 * buscava TODOS os usuários do Supabase Auth (risco de DoS + exposição desnecessária).
 */
export async function resolverEmailsPorIds(userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (userIds.length === 0) return map;

  const idsUnicos = [...new Set(userIds)];
  await Promise.all(
    idsUnicos.map(async (id) => {
      const email = await resolverEmailPorId(id);
      map.set(id, email);
    }),
  );

  return map;
}

