// Cliente Supabase com service role — BYPASSA RLS. Só pode ser usado no servidor,
// nunca importado por código que rode no browser (PRD §9). É a porta de escrita
// transacional usada pelos repositórios e pelo orquestrador.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, getServerEnv } from '@/lib/env';

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
