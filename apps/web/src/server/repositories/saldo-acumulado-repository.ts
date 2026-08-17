// Saldo Acumulado Repository — produção retida de médico com menos de 5 guias combinadas numa
// competência (migration 0048, achado real 2026-08-13). Única tabela do schema com estado que
// ATRAVESSA competências, ligado ao médico (não à execução) — 1 linha por médico (upsert),
// apagada quando o saldo é finalmente consumido num boleto (`limparSaldoAcumulado`).
import type { SaldoAcumulado } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';

/** Saldo persistido, com a competência em que começou a acumular (informativo pra UI/auditoria). */
export interface SaldoAcumuladoPersistido extends SaldoAcumulado {
  competenciaOrigem: string;
}

interface SaldoAcumuladoRow {
  medico_id: string;
  guias_principal: number;
  guias_outros_hospitais: number;
  guias_imobilizacoes: number;
  valor_base_percentual: number;
  competencia_origem: string;
}

function toSaldoAcumulado(row: SaldoAcumuladoRow): SaldoAcumuladoPersistido {
  return {
    guiasPrincipal: row.guias_principal,
    guiasOutrosHospitais: row.guias_outros_hospitais,
    guiasImobilizacoes: row.guias_imobilizacoes,
    valorBasePercentual: row.valor_base_percentual,
    competenciaOrigem: row.competencia_origem,
  };
}

/** Busca o saldo retido de um médico. Null = sem saldo pendente (caso comum). */
export async function buscarSaldoAcumulado(medicoId: string): Promise<SaldoAcumuladoPersistido | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('medicos_saldo_acumulado')
    .select('*')
    .eq('medico_id', medicoId)
    .maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao buscar saldo acumulado', 'DB_ERROR', { error: error.message });
  }
  if (!data) return null;
  return toSaldoAcumulado(data as SaldoAcumuladoRow);
}

/**
 * Grava (upsert) o saldo retido de um médico — chamado quando o Engine devolve
 * `status: 'acumulado'`. `competenciaOrigem` é decidida pelo chamador (orquestrador): mantém a
 * competência já lida em `buscarSaldoAcumulado` se já havia saldo, ou usa a competência atual se
 * é a primeira vez que este médico começa a acumular — o repositório não decide isso sozinho.
 */
export async function gravarSaldoAcumulado(
  medicoId: string,
  saldo: SaldoAcumulado,
  competenciaOrigem: string,
  execucaoResultadoId: string,
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from('medicos_saldo_acumulado').upsert(
    {
      medico_id: medicoId,
      guias_principal: saldo.guiasPrincipal,
      guias_outros_hospitais: saldo.guiasOutrosHospitais,
      guias_imobilizacoes: saldo.guiasImobilizacoes,
      valor_base_percentual: saldo.valorBasePercentual,
      competencia_origem: competenciaOrigem,
      execucao_resultado_id_origem: execucaoResultadoId,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'medico_id' },
  );
  if (error) {
    throw new ApiError(500, 'Falha ao gravar saldo acumulado', 'DB_ERROR', { error: error.message });
  }
}

/** Limpa o saldo retido de um médico — consumido num boleto, ou nunca existiu (no-op nesse caso). */
export async function limparSaldoAcumulado(medicoId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from('medicos_saldo_acumulado').delete().eq('medico_id', medicoId);
  if (error) {
    throw new ApiError(500, 'Falha ao limpar saldo acumulado', 'DB_ERROR', { error: error.message });
  }
}
