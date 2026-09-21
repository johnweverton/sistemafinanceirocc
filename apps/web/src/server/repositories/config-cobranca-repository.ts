// Config Cobrança Repository — lê os defaults comerciais globais (tabela singleton
// config_cobranca, id=1) e resolve as condições efetivas por médico:
// override do médico ?? default global (architecture §5.1).
import type { CondicoesCobranca, ConfigCobranca, CondicoesEmissao } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';

interface ConfigCobrancaRow {
  id: number;
  dias_vencimento: number;
  multa_percent: number | null;
  juros_mes_percent: number | null;
  desconto_percent: number | null;
  desconto_dias: number | null;
  /** Valor da consulta pediátrica (migration 0026) — opcional em bancos sem a migration. */
  valor_consulta_pediatria?: number | null;
}

function toConfig(row: ConfigCobrancaRow): ConfigCobranca {
  return {
    diasVencimento: row.dias_vencimento,
    multaPercent: row.multa_percent,
    jurosMesPercent: row.juros_mes_percent,
    descontoPercent: row.desconto_percent,
    descontoDias: row.desconto_dias,
    valorConsultaPediatria: row.valor_consulta_pediatria ?? 3.0, // default seguro pré-migration 0026
  };
}

/** Lê o singleton config_cobranca (id=1). Se ausente, aplica default seguro (30 dias). */
export async function lerConfig(): Promise<ConfigCobranca> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('config_cobranca').select('*').eq('id', 1).maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao ler config de cobrança', 'DB_ERROR', { error: error.message });
  }
  if (!data) {
    // Fallback: o seed da migration 0006 cria a linha; se faltar, não travar a emissão.
    return {
      diasVencimento: 30,
      multaPercent: null,
      jurosMesPercent: null,
      descontoPercent: null,
      descontoDias: null,
      valorConsultaPediatria: 3.0,
    };
  }
  return toConfig(data as ConfigCobrancaRow);
}

/** Grava (upsert) o singleton config_cobranca (id=1). Escrita restrita a admin (checada na rota). */
export async function atualizarConfig(config: ConfigCobranca): Promise<ConfigCobranca> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('config_cobranca')
    .upsert({
      id: 1,
      dias_vencimento: config.diasVencimento,
      multa_percent: config.multaPercent,
      juros_mes_percent: config.jurosMesPercent,
      desconto_percent: config.descontoPercent,
      desconto_dias: config.descontoDias,
      valor_consulta_pediatria: config.valorConsultaPediatria,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao salvar config de cobrança', 'DB_ERROR', { error: error.message });
  }
  return toConfig(data as ConfigCobrancaRow);
}

/** Lê só o valor unitário da consulta pediátrica — usado pelo orquestrador (Story 10.2). */
export async function lerValorConsultaPediatria(): Promise<number> {
  const config = await lerConfig();
  return config.valorConsultaPediatria;
}

/**
 * Resolve as condições efetivas: cada campo usa o override do médico quando definido,
 * senão herda o default global. `diasVencimento` sempre resolve para um número.
 */
export function resolverCondicoes(
  config: ConfigCobranca,
  overrides: CondicoesCobranca | null | undefined,
): CondicoesEmissao {
  // Dia fixo (Epic 11) é sempre um override explícito por pagador — o default global do
  // escritório continua 'dias_corridos' (não existe "dia fixo padrão da casa").
  const modoVencimento = overrides?.modoVencimento === 'dia_fixo' ? 'dia_fixo' : 'dias_corridos';
  return {
    diasVencimento: overrides?.diasVencimento ?? config.diasVencimento,
    multaPercent: overrides?.multaPercent ?? config.multaPercent,
    jurosMesPercent: overrides?.jurosMesPercent ?? config.jurosMesPercent,
    descontoPercent: overrides?.descontoPercent ?? config.descontoPercent,
    descontoDias: overrides?.descontoDias ?? config.descontoDias,
    modoVencimento,
    diaFixoVencimento: modoVencimento === 'dia_fixo' ? (overrides?.diaFixoVencimento ?? null) : null,
  };
}
