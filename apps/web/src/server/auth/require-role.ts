// Guarda de papel para Route Handlers (architecture: Authentication and Authorization).
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';

export type Papel = 'admin' | 'colaborador' | 'financeiro';

export interface SessaoUsuario {
  userId: string;
  papel: Papel;
  colaboradorResponsavel: string | null;
}

/** Garante sessão válida e papel autorizado; devolve o perfil. Lança ApiError 401/403. */
export async function requireRole(papeis: Papel[]): Promise<SessaoUsuario> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError(401, 'Não autenticado', 'UNAUTHENTICATED');

  // Lê o perfil via service role para não depender de policy de leitura cruzada.
  const admin = getSupabaseAdmin();
  const { data: profile, error } = await admin
    .from('profiles')
    .select('papel, colaborador_responsavel')
    .eq('id', user.id)
    .single();

  if (error || !profile) throw new ApiError(403, 'Perfil não encontrado', 'NO_PROFILE');
  if (!papeis.includes(profile.papel as Papel)) {
    throw new ApiError(403, 'Sem permissão para esta ação', 'FORBIDDEN');
  }

  return {
    userId: user.id,
    papel: profile.papel as Papel,
    colaboradorResponsavel: profile.colaborador_responsavel ?? null,
  };
}
