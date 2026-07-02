// Guarda de papel para Route Handlers (architecture: Authentication and Authorization).
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getServerEnv } from '@/lib/env';
import { ApiError } from '@/lib/api-error';

/** E-mails autorizados a auto-provisionar como admin no primeiro acesso (bootstrap). */
function bootstrapAdminEmails(): Set<string> {
  const raw = getServerEnv().BOOTSTRAP_ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

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

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('papel, colaborador_responsavel')
    .eq('id', user.id)
    .maybeSingle();

  // Sem perfil: NÃO conceder admin automaticamente (isso permitia escalação de privilégio —
  // qualquer usuário que fizesse signup virava admin). Só e-mails na allowlist de bootstrap
  // são provisionados como admin; qualquer outro é barrado até um admin criar seu perfil.
  if (!profile) {
    const email = user.email?.toLowerCase();
    if (email && bootstrapAdminEmails().has(email)) {
      await admin.from('profiles').insert({
        id: user.id,
        papel: 'admin',
        colaborador_responsavel: null,
      });
      return { userId: user.id, papel: 'admin', colaboradorResponsavel: null };
    }
    throw new ApiError(
      403,
      'Usuário sem perfil de acesso. Contate um administrador para liberar seu acesso.',
      'SEM_PERFIL',
    );
  }

  if (!papeis.includes(profile.papel as Papel)) {
    throw new ApiError(403, 'Sem permissão para esta ação', 'FORBIDDEN');
  }

  return {
    userId: user.id,
    papel: profile.papel as Papel,
    colaboradorResponsavel: profile.colaborador_responsavel ?? null,
  };
}
