// Cliente Contábil Repository — ÚNICA porta de escrita/leitura de clientes_contabilidade e
// clientes_contabilidade_historico (Story 11.1, Epic 11). Mesmo padrão de empresa-repository.ts:
// toda escrita gera histórico com autor e motivo (PRD §7).
import type { ClienteContabilidade, ClienteContabilidadeHistorico } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toClienteContabilidade,
  toClienteContabilidadeHistorico,
  clienteContabilidadeUpdateToRow,
  type ClienteContabilidadeRow,
  type ClienteContabilidadeHistoricoRow,
} from './mappers';

export interface ClienteContabilidadeFiltro {
  ativo?: boolean;
}

// contaEmissora fica fora do Pick (mesmo padrão de NovaEmpresa/NovoMedico): o Zod
// (novoClienteContabilidadeSchema) a torna opcional propositalmente (ausente → default 'mc' do
// banco); a chamada de criarClienteContabilidade recebe o objeto parseado do Zod, que tem mais
// campos por tipagem estrutural (não é literal).
export type NovoClienteContabilidade = Pick<
  ClienteContabilidade,
  | 'nome'
  | 'regimeTributario'
  | 'modoCobranca'
  | 'cobranca'
  | 'condicoes'
  | 'regraPreco'
  | 'adicionalAtivo'
  | 'adicionalValor'
  | 'adicionalIntervaloMeses'
  | 'adicionalCompetenciaBase'
  | 'ativo'
>;

export async function listarClientesContabilidade(
  filtro: ClienteContabilidadeFiltro = {},
): Promise<ClienteContabilidade[]> {
  const db = getSupabaseAdmin();
  let query = db.from('clientes_contabilidade').select('*').order('nome', { ascending: true });
  if (filtro.ativo !== undefined) query = query.eq('ativo', filtro.ativo);
  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, 'Falha ao listar clientes contábeis', 'DB_ERROR', { error: error.message });
  }
  return (data as ClienteContabilidadeRow[]).map(toClienteContabilidade);
}

export async function buscarClienteContabilidade(id: string): Promise<ClienteContabilidade | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('clientes_contabilidade').select('*').eq('id', id).maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao buscar cliente contábil', 'DB_ERROR', { error: error.message });
  }
  return data ? toClienteContabilidade(data as ClienteContabilidadeRow) : null;
}

export async function criarClienteContabilidade(
  dados: NovoClienteContabilidade,
): Promise<ClienteContabilidade> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('clientes_contabilidade')
    .insert(clienteContabilidadeUpdateToRow(dados))
    .select('*')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao criar cliente contábil', 'DB_ERROR', { error: error.message });
  }
  return toClienteContabilidade(data as ClienteContabilidadeRow);
}

/**
 * Atualiza um cliente contábil e grava o histórico das mudanças na MESMA operação.
 * `motivo` é obrigatório (PRD §8.2, mesmo padrão de médico/empresa). Só registra histórico dos
 * campos que mudaram.
 */
export async function atualizarClienteContabilidade(
  id: string,
  dados: Partial<NovoClienteContabilidade>,
  autorId: string,
  motivo: string,
): Promise<ClienteContabilidade> {
  if (!motivo || !motivo.trim()) {
    throw new ApiError(422, 'Motivo é obrigatório para alterar um cliente contábil', 'MOTIVO_OBRIGATORIO');
  }

  const db = getSupabaseAdmin();
  const atual = await buscarClienteContabilidade(id);
  if (!atual) throw new ApiError(404, 'Cliente contábil não encontrado', 'NOT_FOUND');

  const atualRec = atual as unknown as Record<string, unknown>;
  const alteracoes = Object.entries(dados)
    .filter(([campo, valorNovo]) => valorNovo !== undefined && valorNovo !== atualRec[campo])
    .map(([campo, valorNovo]) => ({
      cliente_contabilidade_id: id,
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
    .from('clientes_contabilidade')
    .update({ ...clienteContabilidadeUpdateToRow(dados), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (updErr) {
    throw new ApiError(500, 'Falha ao atualizar cliente contábil', 'DB_ERROR', { error: updErr.message });
  }

  const { error: histErr } = await db.from('clientes_contabilidade_historico').insert(alteracoes);
  if (histErr) {
    throw new ApiError(
      500,
      'Cliente contábil atualizado mas histórico falhou. Verificar',
      'HISTORICO_ERROR',
      { error: histErr.message },
    );
  }

  return toClienteContabilidade(atualizado as ClienteContabilidadeRow);
}

/**
 * Exclui um cliente contábil permanentemente. Sem bloqueio por vínculo nesta story (11.1) — não
 * existe FK apontando pra cá ainda (só a partir da 11.3, quando `execucoes` passar a referenciar
 * `clientes_contabilidade`).
 */
export async function excluirClienteContabilidade(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  const atual = await buscarClienteContabilidade(id);
  if (!atual) throw new ApiError(404, 'Cliente contábil não encontrado', 'NOT_FOUND');

  const { error: histErr } = await db
    .from('clientes_contabilidade_historico')
    .delete()
    .eq('cliente_contabilidade_id', id);
  if (histErr) {
    throw new ApiError(500, 'Falha ao remover histórico do cliente contábil', 'DB_ERROR', {
      error: histErr.message,
    });
  }

  const { error: delErr } = await db.from('clientes_contabilidade').delete().eq('id', id);
  if (delErr) {
    throw new ApiError(500, 'Falha ao excluir cliente contábil', 'DB_ERROR', { error: delErr.message });
  }
}

export interface ExclusaoLoteResultado {
  excluidos: number;
  bloqueados: { id: string; nome: string; motivo: string }[];
}

/** Exclui vários clientes contábeis; falha individual não aborta o lote. */
export async function excluirClientesContabilidade(ids: string[]): Promise<ExclusaoLoteResultado> {
  const resultado: ExclusaoLoteResultado = { excluidos: 0, bloqueados: [] };
  for (const id of ids) {
    const cliente = await buscarClienteContabilidade(id);
    if (!cliente) {
      resultado.bloqueados.push({ id, nome: '—', motivo: 'Cliente contábil não encontrado' });
      continue;
    }
    try {
      await excluirClienteContabilidade(id);
      resultado.excluidos += 1;
    } catch (e) {
      const motivo = e instanceof ApiError ? e.message : 'Falha ao excluir cliente contábil';
      resultado.bloqueados.push({ id, nome: cliente.nome, motivo });
    }
  }
  return resultado;
}

export async function historicoDoClienteContabilidade(id: string): Promise<ClienteContabilidadeHistorico[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('clientes_contabilidade_historico')
    .select('*')
    .eq('cliente_contabilidade_id', id)
    .order('alterado_em', { ascending: false });
  if (error) {
    throw new ApiError(500, 'Falha ao buscar histórico', 'DB_ERROR', { error: error.message });
  }
  return (data as ClienteContabilidadeHistoricoRow[]).map(toClienteContabilidadeHistorico);
}
