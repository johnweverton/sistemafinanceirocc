// Plano de Contas Repository — cadastro editável de categorias do DRE + regras de
// categorização por palavra-chave (Story 9.1, Épico 9). Escrita via service role
// (diferenciação admin-só vs admin/financeiro é responsabilidade da rota, 9.2).
// Categorias `sistema=true` (Receita de honorários / Tarifas bancárias) são protegidas:
// nunca deletáveis nem desativáveis — quebrariam a auto-categorização do motor (9.2).
import type {
  PlanoContas,
  GrupoPlanoContas,
  RegraCategorizacao,
  CampoRegraCategorizacao,
} from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import {
  toPlanoContas,
  toRegraCategorizacao,
  type PlanoContasRow,
  type RegraCategorizacaoRow,
} from './mappers';

// ---------------------------------------------------------------------------
// Categorias (plano_contas)
// ---------------------------------------------------------------------------

export interface CriarCategoriaInput {
  grupo: GrupoPlanoContas;
  nome: string;
  ordem?: number;
}

export async function criarCategoria(input: CriarCategoriaInput): Promise<PlanoContas> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('plano_contas')
    .insert({ grupo: input.grupo, nome: input.nome, ordem: input.ordem ?? 0 })
    .select('*')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao criar categoria do plano de contas', 'DB_ERROR', {
      error: error.message,
    });
  }
  return toPlanoContas(data as PlanoContasRow);
}

export interface FiltroCategorias {
  ativo?: boolean;
}

export async function listarCategorias(filtro: FiltroCategorias = {}): Promise<PlanoContas[]> {
  const db = getSupabaseAdmin();
  let query = db.from('plano_contas').select('*').order('grupo').order('ordem');
  if (filtro.ativo !== undefined) query = query.eq('ativo', filtro.ativo);
  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, 'Falha ao listar plano de contas', 'DB_ERROR', { error: error.message });
  }
  return (data as PlanoContasRow[]).map(toPlanoContas);
}

async function buscarCategoria(id: string): Promise<PlanoContas | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('plano_contas').select('*').eq('id', id).maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao buscar categoria do plano de contas', 'DB_ERROR', {
      error: error.message,
    });
  }
  return data ? toPlanoContas(data as PlanoContasRow) : null;
}

export interface AtualizarCategoriaInput {
  nome?: string;
  ordem?: number;
}

/** Atualiza nome/ordem. `grupo`/`sistema` nunca são aceitos aqui — não existe parâmetro
 * para isso (D3): a proteção da categoria de sistema é garantida pela assinatura da função,
 * não por um `if` que poderia ser contornado. */
export async function atualizarCategoria(
  id: string,
  patch: AtualizarCategoriaInput,
): Promise<PlanoContas> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('plano_contas')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao atualizar categoria do plano de contas', 'DB_ERROR', {
      error: error.message,
    });
  }
  if (!data) throw new ApiError(404, 'Categoria do plano de contas não encontrada', 'NOT_FOUND', { id });
  return toPlanoContas(data as PlanoContasRow);
}

/** Desativa (soft-disable) — nunca deleta. Categoria de sistema nunca desativa (quebraria a auto-categorização da 9.2). */
export async function desativarCategoria(id: string): Promise<PlanoContas> {
  const categoria = await buscarCategoria(id);
  if (!categoria) throw new ApiError(404, 'Categoria do plano de contas não encontrada', 'NOT_FOUND', { id });
  if (categoria.sistema) {
    throw new ApiError(400, 'Categoria de sistema não pode ser desativada.', 'CATEGORIA_SISTEMA_PROTEGIDA', { id });
  }
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('plano_contas')
    .update({ ativo: false })
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao desativar categoria do plano de contas', 'DB_ERROR', {
      error: error.message,
    });
  }
  return toPlanoContas(data as PlanoContasRow);
}

/**
 * DELETE físico — só permitido para categoria ATIVA e sem nenhum vínculo (extrato,
 * lançamentos manuais, regras). Categoria já desativada ou em uso nunca é deletada:
 * o caminho é `desativarCategoria` (histórico não pode quebrar). Nunca em `sistema=true`.
 */
export async function excluirCategoria(id: string): Promise<void> {
  const categoria = await buscarCategoria(id);
  if (!categoria) throw new ApiError(404, 'Categoria do plano de contas não encontrada', 'NOT_FOUND', { id });
  if (categoria.sistema) {
    throw new ApiError(400, 'Categoria de sistema não pode ser excluída.', 'CATEGORIA_SISTEMA_PROTEGIDA', { id });
  }
  if (!categoria.ativo) {
    throw new ApiError(
      400,
      'Categoria já está desativada — exclusão física exige categoria ativa e sem uso.',
      'CATEGORIA_INATIVA',
      { id },
    );
  }

  const db = getSupabaseAdmin();
  const contagens = await Promise.all([
    db.from('extrato_transacoes').select('id', { count: 'exact', head: true }).eq('categoria_id', id),
    db.from('dre_lancamentos_manuais').select('id', { count: 'exact', head: true }).eq('categoria_id', id),
    db.from('plano_contas_regras').select('id', { count: 'exact', head: true }).eq('categoria_id', id),
  ]);
  for (const r of contagens) {
    if (r.error) {
      throw new ApiError(500, 'Falha ao verificar uso da categoria', 'DB_ERROR', { error: r.error.message });
    }
  }
  const totalVinculos = contagens.reduce((soma, r) => soma + (r.count ?? 0), 0);
  if (totalVinculos > 0) {
    throw new ApiError(409, 'Categoria em uso — desative em vez de excluir.', 'CATEGORIA_EM_USO', {
      id,
      vinculos: totalVinculos,
    });
  }

  const { error } = await db.from('plano_contas').delete().eq('id', id);
  if (error) {
    throw new ApiError(500, 'Falha ao excluir categoria do plano de contas', 'DB_ERROR', {
      error: error.message,
    });
  }
}

export interface CategoriasSistemaIds {
  receitaHonorariosId: string;
  tarifasBancariasId: string;
}

/**
 * Localiza as 2 categorias de sistema por `sistema=true` + `grupo` — NUNCA por `nome`
 * (D3, 9.2): `atualizarCategoria` permite renomear qualquer categoria, inclusive as de
 * sistema; dentro de cada grupo só existe 1 linha `sistema=true` (seed da migration 0023).
 */
export async function buscarCategoriasSistema(): Promise<CategoriasSistemaIds> {
  const categorias = await listarCategorias();
  const receita = categorias.find((c) => c.sistema && c.grupo === 'receita');
  const tarifa = categorias.find((c) => c.sistema && c.grupo === 'deducao_receita');
  if (!receita || !tarifa) {
    throw new ApiError(
      500,
      'Categorias de sistema do plano de contas não encontradas — seed da migration 0023 ausente?',
      'CATEGORIAS_SISTEMA_AUSENTES',
    );
  }
  return { receitaHonorariosId: receita.id, tarifasBancariasId: tarifa.id };
}

// ---------------------------------------------------------------------------
// Regras de categorização (plano_contas_regras)
// ---------------------------------------------------------------------------

export interface CriarRegraInput {
  categoriaId: string;
  campo: CampoRegraCategorizacao;
  padrao: string;
  prioridade?: number;
}

export async function criarRegra(input: CriarRegraInput): Promise<RegraCategorizacao> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('plano_contas_regras')
    .insert({
      categoria_id: input.categoriaId,
      campo: input.campo,
      padrao: input.padrao,
      prioridade: input.prioridade ?? 0,
    })
    .select('*')
    .single();
  if (error) {
    throw new ApiError(500, 'Falha ao criar regra de categorização', 'DB_ERROR', { error: error.message });
  }
  return toRegraCategorizacao(data as RegraCategorizacaoRow);
}

export interface FiltroRegras {
  ativo?: boolean;
}

export async function listarRegras(filtro: FiltroRegras = {}): Promise<RegraCategorizacao[]> {
  const db = getSupabaseAdmin();
  let query = db.from('plano_contas_regras').select('*').order('prioridade');
  if (filtro.ativo !== undefined) query = query.eq('ativo', filtro.ativo);
  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, 'Falha ao listar regras de categorização', 'DB_ERROR', { error: error.message });
  }
  return (data as RegraCategorizacaoRow[]).map(toRegraCategorizacao);
}

export interface AtualizarRegraInput {
  campo?: CampoRegraCategorizacao;
  padrao?: string;
  prioridade?: number;
}

export async function atualizarRegra(
  id: string,
  patch: AtualizarRegraInput,
): Promise<RegraCategorizacao> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('plano_contas_regras')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao atualizar regra de categorização', 'DB_ERROR', { error: error.message });
  }
  if (!data) throw new ApiError(404, 'Regra de categorização não encontrada', 'NOT_FOUND', { id });
  return toRegraCategorizacao(data as RegraCategorizacaoRow);
}

export async function desativarRegra(id: string): Promise<RegraCategorizacao> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('plano_contas_regras')
    .update({ ativo: false })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    throw new ApiError(500, 'Falha ao desativar regra de categorização', 'DB_ERROR', { error: error.message });
  }
  if (!data) throw new ApiError(404, 'Regra de categorização não encontrada', 'NOT_FOUND', { id });
  return toRegraCategorizacao(data as RegraCategorizacaoRow);
}

/**
 * DELETE físico — regra é cadastro-folha (nenhuma outra tabela referencia
 * plano_contas_regras.id), então não precisa do guard de vínculos que excluirCategoria tem.
 */
export async function excluirRegra(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from('plano_contas_regras').delete().eq('id', id);
  if (error) {
    throw new ApiError(500, 'Falha ao excluir regra de categorização', 'DB_ERROR', { error: error.message });
  }
}
