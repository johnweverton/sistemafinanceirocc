// Config Lembrete de Vencimento Repository — lê/grava o singleton config_lembrete_vencimento
// (id=1): habilita/desabilita o lembrete automático D-1 (Épico 13), editável em Configurações.
import type { ConfigLembreteVencimento } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';

interface ConfigLembreteVencimentoRow {
  id: number;
  habilitado: boolean;
}

const DEFAULT: ConfigLembreteVencimento = { habilitado: false };

function toConfig(row: ConfigLembreteVencimentoRow): ConfigLembreteVencimento {
  return { habilitado: row.habilitado };
}

/** Lê o singleton config_lembrete_vencimento (id=1). Se ausente, devolve o default (desabilitado). */
export async function lerConfig(): Promise<ConfigLembreteVencimento> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('config_lembrete_vencimento').select('*').eq('id', 1).maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao ler config do lembrete de vencimento', 'DB_ERROR', { error: error.message });
  }
  if (!data) return DEFAULT;
  return toConfig(data as ConfigLembreteVencimentoRow);
}

/** Grava (upsert) o singleton config_lembrete_vencimento (id=1). Escrita restrita a admin (checada na rota). */
export async function atualizarConfig(config: ConfigLembreteVencimento): Promise<ConfigLembreteVencimento> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('config_lembrete_vencimento')
    .upsert({
      id: 1,
      habilitado: config.habilitado,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao salvar config do lembrete de vencimento', 'DB_ERROR', { error: error.message });
  }
  return toConfig(data as ConfigLembreteVencimentoRow);
}
