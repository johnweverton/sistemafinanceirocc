// Empresa Repository — ÚNICA porta de escrita/leitura de empresas e empresas_historico
// (Story 10.4a, Épico 10). Mesmo padrão de medico-repository.ts: toda escrita gera
// histórico com autor e motivo (PRD §7).
import type { Empresa, EmpresaHistorico } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toEmpresa,
  toEmpresaHistorico,
  empresaUpdateToRow,
  type EmpresaRow,
  type EmpresaHistoricoRow,
} from './mappers';

export interface EmpresaFiltro {
  ativo?: boolean;
}

// contaEmissora fica fora do Pick (mesmo padrão de NovoMedico): o Zod (novaEmpresaSchema) a
// torna opcional propositalmente (ausente → default 'mc' do banco); a chamada de criarEmpresa
// recebe o objeto parseado do Zod, que tem mais campos por tipagem estrutural (não é literal).
export type NovaEmpresa = Pick<Empresa, 'nome' | 'cobranca' | 'condicoes' | 'regraPreco' | 'ativo'>;

export async function listarEmpresas(filtro: EmpresaFiltro = {}): Promise<Empresa[]> {
  const db = getSupabaseAdmin();
  let query = db.from('empresas').select('*').order('nome', { ascending: true });
  if (filtro.ativo !== undefined) query = query.eq('ativo', filtro.ativo);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Falha ao listar empresas', 'DB_ERROR', { error: error.message });
  return (data as EmpresaRow[]).map(toEmpresa);
}

export async function buscarEmpresa(id: string): Promise<Empresa | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('empresas').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar empresa', 'DB_ERROR', { error: error.message });
  return data ? toEmpresa(data as EmpresaRow) : null;
}

export async function criarEmpresa(dados: NovaEmpresa): Promise<Empresa> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('empresas')
    .insert(empresaUpdateToRow(dados))
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao criar empresa', 'DB_ERROR', { error: error.message });
  return toEmpresa(data as EmpresaRow);
}

/**
 * Atualiza uma empresa e grava o histórico das mudanças na MESMA operação.
 * `motivo` é obrigatório (PRD §8.2, mesmo padrão de médico). Só registra histórico dos
 * campos que mudaram.
 */
export async function atualizarEmpresa(
  id: string,
  dados: Partial<NovaEmpresa>,
  autorId: string,
  motivo: string,
): Promise<Empresa> {
  if (!motivo || !motivo.trim()) {
    throw new ApiError(422, 'Motivo é obrigatório para alterar uma empresa', 'MOTIVO_OBRIGATORIO');
  }

  const db = getSupabaseAdmin();
  const atual = await buscarEmpresa(id);
  if (!atual) throw new ApiError(404, 'Empresa não encontrada', 'NOT_FOUND');

  const atualRec = atual as unknown as Record<string, unknown>;
  const alteracoes = Object.entries(dados)
    .filter(([campo, valorNovo]) => valorNovo !== undefined && valorNovo !== atualRec[campo])
    .map(([campo, valorNovo]) => ({
      empresa_id: id,
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
    .from('empresas')
    .update({ ...empresaUpdateToRow(dados), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (updErr) throw new ApiError(500, 'Falha ao atualizar empresa', 'DB_ERROR', { error: updErr.message });

  const { error: histErr } = await db.from('empresas_historico').insert(alteracoes);
  if (histErr) {
    throw new ApiError(500, 'Empresa atualizada mas histórico falhou — verificar', 'HISTORICO_ERROR', {
      error: histErr.message,
    });
  }

  return toEmpresa(atualizado as EmpresaRow);
}

/**
 * Exclui uma empresa permanentemente. Bloqueada se houver qualquer médico vinculado
 * (`empresa_grupo_id`) — o caminho correto nesse caso é desvincular os médicos primeiro
 * (ou inativar a empresa via `ativo`), não excluir com vínculos pendentes.
 */
export async function excluirEmpresa(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  const atual = await buscarEmpresa(id);
  if (!atual) throw new ApiError(404, 'Empresa não encontrada', 'NOT_FOUND');

  const { count, error: countErr } = await db
    .from('medicos')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_grupo_id', id);
  if (countErr) {
    throw new ApiError(500, 'Falha ao verificar médicos vinculados', 'DB_ERROR', { error: countErr.message });
  }
  if ((count ?? 0) > 0) {
    throw new ApiError(
      409,
      'Empresa possui médicos vinculados — desvincule-os antes de excluir, ou inative a empresa.',
      'POSSUI_MEDICOS_VINCULADOS',
    );
  }

  const { error: histErr } = await db.from('empresas_historico').delete().eq('empresa_id', id);
  if (histErr) {
    throw new ApiError(500, 'Falha ao remover histórico da empresa', 'DB_ERROR', { error: histErr.message });
  }

  const { error: delErr } = await db.from('empresas').delete().eq('id', id);
  if (delErr) {
    throw new ApiError(500, 'Falha ao excluir empresa', 'DB_ERROR', { error: delErr.message });
  }
}

export async function historicoDaEmpresa(id: string): Promise<EmpresaHistorico[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('empresas_historico')
    .select('*')
    .eq('empresa_id', id)
    .order('alterado_em', { ascending: false });
  if (error) throw new ApiError(500, 'Falha ao buscar histórico', 'DB_ERROR', { error: error.message });
  return (data as EmpresaHistoricoRow[]).map(toEmpresaHistorico);
}
