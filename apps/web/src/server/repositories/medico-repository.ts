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
  | 'cobranca'
  | 'condicoes'
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

/** Retorna médicos auto-descobertos que ainda aguardam configuração dos parâmetros. */
export async function listarAguardandoConfiguracao(): Promise<Medico[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('medicos')
    .select('*')
    .eq('necessita_configuracao', true)
    .order('nome', { ascending: true });
  if (error) throw new ApiError(500, 'Falha ao listar médicos pendentes', 'DB_ERROR', { error: error.message });
  return (data as MedicoRow[]).map(toMedico);
}

export async function buscarMedico(id: string): Promise<Medico | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('medicos').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar médico', 'DB_ERROR', { error: error.message });
  return data ? toMedico(data as MedicoRow) : null;
}

/** Conta médicos ativos e configurados — hot path do orquestrador. */
export async function contarMedicosAtivos(): Promise<number> {
  const db = getSupabaseAdmin();
  const { count, error } = await db
    .from('medicos')
    .select('id', { count: 'exact', head: true })
    .eq('ativo', true)
    .eq('necessita_configuracao', false);
  if (error) throw new ApiError(500, 'Falha ao contar médicos', 'DB_ERROR', { error: error.message });
  return count ?? 0;
}

/**
 * Lê uma página de médicos ativos, ordenada de forma estável (por id) para servir de
 * cursor de lote no processamento encadeado: `offset` = quantos já foram processados.
 */
/** Página de médicos ativos e configurados — cursor estável para o orquestrador. */
export async function listarMedicosAtivosPagina(offset: number, limite: number): Promise<Medico[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('medicos')
    .select('*')
    .eq('ativo', true)
    .eq('necessita_configuracao', false)
    .order('id', { ascending: true })
    .range(offset, offset + limite - 1);
  if (error) throw new ApiError(500, 'Falha ao paginar médicos', 'DB_ERROR', { error: error.message });
  return (data as MedicoRow[]).map(toMedico);
}

export interface MedicoDescoberto {
  cpf: string;
  nome: string;
  especialidade: string | null;
}

/**
 * Cria stubs para CPFs novos recebidos da API da Carmem.
 * Idempotente: CPFs já existentes são ignorados. Retorna quantos stubs foram criados.
 * Os valores de faturamento padrão (nao_credenciado/false) são placeholders — o médico
 * NÃO entra em execuções até necessita_configuracao = false (operador configura via UI).
 */
export async function descobrirMedicos(novos: MedicoDescoberto[]): Promise<number> {
  if (novos.length === 0) return 0;
  const db = getSupabaseAdmin();

  // Verifica quais CPFs já existem para não duplicar.
  const cpfs = novos.map((m) => m.cpf);
  const { data: existentes } = await db
    .from('medicos')
    .select('cpf')
    .in('cpf', cpfs);

  const cpfsExistentes = new Set((existentes ?? []).map((r: { cpf: string }) => r.cpf));
  const paraInserir = novos.filter((m) => !cpfsExistentes.has(m.cpf));
  if (paraInserir.length === 0) return 0;

  const rows = paraInserir.map((m) => ({
    cpf: m.cpf,
    nome: m.nome,
    especialidade: m.especialidade,
    // Valores placeholder — não entram no cálculo enquanto necessita_configuracao = true.
    status_hapvida: 'nao_credenciado' as const,
    faz_outros_hospitais: false,
    faz_imobilizacoes: false,
    modo_mudanca_data: 'nao' as const,
    colaborador_responsavel: null,
    ativo: true,
    necessita_configuracao: true,
  }));

  const { error } = await db.from('medicos').insert(rows);
  if (error) throw new ApiError(500, 'Falha ao criar stubs de médicos', 'DB_ERROR', { error: error.message });
  return paraInserir.length;
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

// ---------------------------------------------------------------------------
// Vínculo com a origem (Épico 5 — sincronização com a API do sistema web)
// ---------------------------------------------------------------------------

/** Busca médico pelo vínculo com a origem (fin-clientes.id). */
export async function buscarPorExternalId(externalId: string): Promise<Medico | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('medicos')
    .select('*')
    .eq('external_id', externalId)
    .maybeSingle();
  if (error) throw new ApiError(500, 'Falha ao buscar médico por vínculo', 'DB_ERROR', { error: error.message });
  return data ? toMedico(data as MedicoRow) : null;
}

/**
 * Confirma o vínculo médico ↔ cliente da origem. O vínculo é PERMANENTE (decisão 4 do
 * épico) — falha 409 se qualquer lado já estiver vinculado. Gera histórico (requisito
 * não-opcional, PRD §7).
 */
export async function vincularExternalId(
  medicoId: string,
  externalId: string,
  autorId: string,
  motivo: string,
): Promise<Medico> {
  const db = getSupabaseAdmin();
  const atual = await buscarMedico(medicoId);
  if (!atual) throw new ApiError(404, 'Médico não encontrado', 'NOT_FOUND');
  if (atual.externalId) {
    throw new ApiError(409, 'Médico já vinculado a um cliente da origem', 'JA_VINCULADO');
  }
  const ocupado = await buscarPorExternalId(externalId);
  if (ocupado) {
    throw new ApiError(409, 'Cliente da origem já vinculado a outro médico', 'EXTERNAL_ID_DUPLICADO');
  }

  const { data, error } = await db
    .from('medicos')
    .update({ external_id: externalId, updated_at: new Date().toISOString() })
    .eq('id', medicoId)
    .select('*')
    .single();
  if (error) {
    // Defesa final: UNIQUE parcial uq_medicos_external_id (0011) em corrida.
    if (error.code === '23505') {
      throw new ApiError(409, 'Cliente da origem já vinculado a outro médico', 'EXTERNAL_ID_DUPLICADO');
    }
    throw new ApiError(500, 'Falha ao vincular médico', 'DB_ERROR', { error: error.message });
  }

  const { error: histErr } = await db.from('medicos_historico').insert({
    medico_id: medicoId,
    campo_alterado: 'external_id',
    valor_anterior: '',
    valor_novo: externalId,
    alterado_por: autorId,
    motivo,
  });
  if (histErr) {
    throw new ApiError(500, 'Médico vinculado mas histórico falhou — verificar', 'HISTORICO_ERROR', {
      error: histErr.message,
    });
  }

  return toMedico(data as MedicoRow);
}

/**
 * Médico novo criado a partir da origem: sem CPF, pendente de configuração (decisão 1).
 * `statusHapvida` restrito aos valores deriváveis — NUNCA 'nenhum' (o CHECK
 * combinacao_classe_valida da 0001 proíbe 'nenhum' + faz_outros_hospitais=false).
 */
export interface NovoMedicoExterno {
  externalId: string;
  nome: string;
  statusHapvida: 'credenciado' | 'nao_credenciado';
}

export async function criarMedicoExterno(
  dados: NovoMedicoExterno,
  autorId: string,
): Promise<Medico> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('medicos')
    .insert({
      cpf: null,
      nome: dados.nome,
      especialidade: null,
      status_hapvida: dados.statusHapvida,
      faz_outros_hospitais: false,
      faz_imobilizacoes: false,
      modo_mudanca_data: 'nao' as const,
      colaborador_responsavel: null,
      ativo: true,
      necessita_configuracao: true, // fora das execuções até o operador completar (0005)
      external_id: dados.externalId,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new ApiError(409, 'Cliente da origem já vinculado a um médico', 'EXTERNAL_ID_DUPLICADO');
    }
    throw new ApiError(500, 'Falha ao criar médico da origem', 'DB_ERROR', { error: error.message });
  }

  const medico = toMedico(data as MedicoRow);
  const { error: histErr } = await db.from('medicos_historico').insert({
    medico_id: medico.id,
    campo_alterado: 'external_id',
    valor_anterior: '',
    valor_novo: dados.externalId,
    alterado_por: autorId,
    motivo: 'Criado via sincronização com o sistema web',
  });
  if (histErr) {
    throw new ApiError(500, 'Médico criado mas histórico falhou — verificar', 'HISTORICO_ERROR', {
      error: histErr.message,
    });
  }
  return medico;
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
