// Config Relatório Mensal Repository — lê/grava o singleton config_relatorio_mensal (id=1):
// destinatários e dia de envio do relatório mensal automático (cron), editáveis em Configurações.
import type { ConfigRelatorioMensal } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';

interface ConfigRelatorioMensalRow {
  id: number;
  emails: string;
  dia_envio: number;
  habilitado: boolean;
}

const DEFAULT: ConfigRelatorioMensal = { emails: '', diaEnvio: 1, habilitado: false };

function toConfig(row: ConfigRelatorioMensalRow): ConfigRelatorioMensal {
  return {
    emails: row.emails,
    diaEnvio: row.dia_envio,
    habilitado: row.habilitado,
  };
}

/** Lê o singleton config_relatorio_mensal (id=1). Se ausente, devolve o default "nunca configurado". */
export async function lerConfig(): Promise<ConfigRelatorioMensal> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('config_relatorio_mensal').select('*').eq('id', 1).maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao ler config do relatório mensal', 'DB_ERROR', { error: error.message });
  }
  if (!data) return DEFAULT;
  return toConfig(data as ConfigRelatorioMensalRow);
}

/** Grava (upsert) o singleton config_relatorio_mensal (id=1). Escrita restrita a admin (checada na rota). */
export async function atualizarConfig(config: ConfigRelatorioMensal): Promise<ConfigRelatorioMensal> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('config_relatorio_mensal')
    .upsert({
      id: 1,
      emails: config.emails,
      dia_envio: config.diaEnvio,
      habilitado: config.habilitado,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao salvar config do relatório mensal', 'DB_ERROR', { error: error.message });
  }
  return toConfig(data as ConfigRelatorioMensalRow);
}
