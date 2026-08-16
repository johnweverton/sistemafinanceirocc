// Relatório Links Repository — links públicos (token) de acesso ao BI de Relatórios.
// Toda escrita/leitura via service role (o token não carrega sessão Supabase alguma).
import { randomBytes } from 'node:crypto';
import type { RelatorioLink, CriarRelatorioLinkInput } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import { toRelatorioLink, type RelatorioLinkRow } from './mappers';

function gerarToken(): string {
  // 256 bits de entropia — a defesa do link é a entropia + revogação, não uma comparação
  // tipo senha (ver comentário da migration 0047).
  return randomBytes(32).toString('base64url');
}

export async function criarLink(criadoPor: string, input: CriarRelatorioLinkInput): Promise<RelatorioLink> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('relatorio_links')
    .insert({
      token: gerarToken(),
      nome: input.nome,
      escopo_conta_emissora: input.escopoContaEmissora ?? null,
      criado_por: criadoPor,
      expira_em: input.expiraEm ?? null,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Falha ao criar link de relatório', 'DB_ERROR', { error: error.message });
  return toRelatorioLink(data as RelatorioLinkRow);
}

export async function listarLinks(): Promise<RelatorioLink[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('relatorio_links').select('*').order('criado_em', { ascending: false });
  if (error) throw new ApiError(500, 'Falha ao listar links de relatório', 'DB_ERROR', { error: error.message });
  return (data as RelatorioLinkRow[]).map(toRelatorioLink);
}

export async function revogarLink(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from('relatorio_links').update({ revogado_em: new Date().toISOString() }).eq('id', id);
  if (error) throw new ApiError(500, 'Falha ao revogar link de relatório', 'DB_ERROR', { error: error.message });
}

/**
 * Usada pela rota pública. Retorna `null` para token inexistente, revogado ou expirado —
 * resposta uniforme (a rota devolve 404 nos três casos, sem revelar o motivo).
 */
export async function buscarLinkValidoPorToken(token: string): Promise<RelatorioLink | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('relatorio_links').select('*').eq('token', token).maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar link de relatório', 'DB_ERROR', { error: error.message });
  if (!data) return null;
  const link = toRelatorioLink(data as RelatorioLinkRow);
  if (link.revogadoEm) return null;
  if (link.expiraEm && new Date(link.expiraEm).getTime() <= Date.now()) return null;
  return link;
}

/** Fire-and-forget (não deve bloquear a resposta da rota pública). */
export async function registrarAcesso(id: string, ip: string | null): Promise<void> {
  const db = getSupabaseAdmin();
  await db
    .from('relatorio_links')
    .update({ ultimo_acesso_em: new Date().toISOString(), ultimo_acesso_ip: ip })
    .eq('id', id);
}
