// Resolve uuid de profile → e-mail via Admin Auth API do Supabase (auth.users não é exposto via
// PostgREST). `profiles` não guarda nome/e-mail (só papel/colaborador_responsavel), então esta é a
// única fonte. Uso não-fatal: se a Admin API falhar, a tela que chamou continua funcionando sem o
// e-mail do autor (fallback null) — nunca deixamos essa resolução quebrar a listagem de execuções.
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/** Resolve um único uuid — usado no relatório de uma execução (ProgressoExecucao). */
export async function resolverEmailPorId(userId: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(userId);
    if (error) return null;
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve vários uuids de uma vez — usado na lista de execuções, para não fazer N chamadas
 * (uma por linha). `listUsers()` sem paginação é aceitável aqui: o universo de usuários internos
 * que disparam execuções é pequeno (staff do escritório), não a base de médicos.
 */
export async function resolverEmailsPorIds(userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (userIds.length === 0) return map;
  try {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers();
    if (error) return map;
    const idsUnicos = new Set(userIds);
    for (const user of data.users) {
      if (idsUnicos.has(user.id)) map.set(user.id, user.email ?? null);
    }
  } catch {
    /* não-fatal — chamador trata ausência com fallback visual */
  }
  return map;
}
