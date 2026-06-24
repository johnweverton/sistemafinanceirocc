// Medico Repository — ÚNICA porta de escrita/leitura de medicos e medicos_historico.
// Regra não-opcional (PRD §7, architecture Coding Standards): toda escrita em médico
// gera histórico com autor e motivo. Nenhuma tela escreve em `medicos` fora daqui.
import type { Medico, MedicoHistorico } from '@cobranca/shared';
import { combinacaoClasseValida } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toMedico,
  toMedicoHistorico,
  medicoUpdateToRow,
  type MedicoRow,
  type MedicoHistoricoRow,
} from './mappers';

export interface MedicoFiltro {
  colaboradorResponsavel?: string;
  ativo?: boolean;
}

export type NovoMedico = Pick<
  Medico,
  | 'cpf'
  | 'nome'
  | 'especialidade'
  | 'statusHapvida'
  | 'fazOutrosHospitais'
  | 'fazImobilizacoes'
  | 'modoMudancaData'
  | 'colaboradorResponsavel'
  | 'ativo'
>;

export async function listarMedicos(filtro: MedicoFiltro = {}): Promise<Medico[]> {
  const db = getSupabaseAdmin();
  let query = db.from('medicos').select('*').order('nome', { ascending: true });
  if (filtro.colaboradorResponsavel) {
    query = query.eq('colaborador_responsavel', filtro.colaboradorResponsavel);
  }
  if (filtro.ativo !== undefined) query = query.eq('ativo', filtro.ativo);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao listar médicos', 'DB_ERROR', { error: error.message });
  return (data as MedicoRow[]).map(toMedico);
}

export async function buscarMedico(id: string): Promise<Medico | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('medicos').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar médico', 'DB_ERROR', { error: error.message });
  return data ? toMedico(data as MedicoRow) : null;
}

/** Conta médicos ativos — usado pelo Orchestrator para definir total e número de lotes. */
export async function contarMedicosAtivos(): Promise<number> {
  const db = getSupabaseAdmin();
  const { count, error } = await db
    .from('medicos')
    .select('id', { count: 'exact', head: true })
    .eq('ativo', true);
  if (error) throw new ApiError(500, 'Falha ao contar médicos', 'DB_ERROR', { error: error.message });
  return count ?? 0;
}

/**
 * Lê uma página de médicos ativos, ordenada de forma estável (por id) para servir de
 * cursor de lote no processamento encadeado: `offset` = quantos já foram processados.
 */
export async function listarMedicosAtivosPagina(offset: number, limite: number): Promise<Medico[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('medicos')
    .select('*')
    .eq('ativo', true)
    .order('id', { ascending: true })
    .range(offset, offset + limite - 1);
  if (error) throw new ApiError(500, 'Falha ao paginar médicos', 'DB_ERROR', { error: error.message });
  return (data as MedicoRow[]).map(toMedico);
}

export async function criarMedico(dados: NovoMedico): Promise<Medico> {
  if (!combinacaoClasseValida(dados)) {
    throw new ApiError(422, 'Combinação inválida: sem Hapvida e sem outros hospitais', 'INVALID_COMBO');
  }
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('medicos')
    .insert(medicoUpdateToRow(dados))
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new ApiError(409, 'CPF já cadastrado', 'CPF_DUPLICADO');
    throw new ApiError(500, 'Falha ao criar médico', 'DB_ERROR', { error: error.message });
  }
  return toMedico(data as MedicoRow);
}

/**
 * Atualiza um médico e grava o histórico das mudanças na MESMA operação.
 * `motivo` é obrigatório (PRD §8.2). Só registra histórico dos campos que mudaram.
 */
export async function atualizarMedico(
  id: string,
  dados: Partial<NovoMedico>,
  autorId: string,
  motivo: string,
): Promise<Medico> {
  if (!motivo || !motivo.trim()) {
    throw new ApiError(422, 'Motivo é obrigatório para alterar um médico', 'MOTIVO_OBRIGATORIO');
  }

  const db = getSupabaseAdmin();
  const atual = await buscarMedico(id);
  if (!atual) throw new ApiError(404, 'Médico não encontrado', 'NOT_FOUND');

  const combinacaoFinal = {
    statusHapvida: dados.statusHapvida ?? atual.statusHapvida,
    fazOutrosHospitais: dados.fazOutrosHospitais ?? atual.fazOutrosHospitais,
  };
  if (!combinacaoClasseValida(combinacaoFinal)) {
    throw new ApiError(422, 'Combinação inválida: sem Hapvida e sem outros hospitais', 'INVALID_COMBO');
  }

  // Calcula o diff ANTES de escrever — só campos que realmente mudaram viram histórico.
  const atualRec = atual as unknown as Record<string, unknown>;
  const alteracoes = Object.entries(dados)
    .filter(([campo, valorNovo]) => valorNovo !== undefined && valorNovo !== atualRec[campo])
    .map(([campo, valorNovo]) => ({
      medico_id: id,
      campo_alterado: campo,
      valor_anterior: String(atualRec[campo] ?? ''),
      valor_novo: String(valorNovo ?? ''),
      alterado_por: autorId,
      motivo,
    }));

  if (alteracoes.length === 0) {
    return atual; // nada mudou, não grava histórico vazio
  }

  const { data: atualizado, error: updErr } = await db
    .from('medicos')
    .update({ ...medicoUpdateToRow(dados), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (updErr) throw new ApiError(500, 'Falha ao atualizar médico', 'DB_ERROR', { error: updErr.message });

  const { error: histErr } = await db.from('medicos_historico').insert(alteracoes);
  if (histErr) {
    // Histórico é requisito não-opcional: se falhar, é erro de sistema, não silenciar.
    throw new ApiError(500, 'Médico atualizado mas histórico falhou — verificar', 'HISTORICO_ERROR', {
      error: histErr.message,
    });
  }

  return toMedico(atualizado as MedicoRow);
}

export async function historicoDoMedico(id: string): Promise<MedicoHistorico[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('medicos_historico')
    .select('*')
    .eq('medico_id', id)
    .order('alterado_em', { ascending: false });
  if (error) throw new ApiError(500, 'Falha ao buscar histórico', 'DB_ERROR', { error: error.message });
  return (data as MedicoHistoricoRow[]).map(toMedicoHistorico);
}
