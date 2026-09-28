// ISS Solicitação Repository — ÚNICA porta de escrita/leitura de `iss_solicitacoes` (Story 13.5,
// Épico 13 — migration 0062). A máquina de estados inteira mora aqui:
//
//   pendente ──(agente reivindica)──▶ em_andamento ──(concluir)──▶ concluida | falhou
//      │                                  │  ▲
//      └──────(operador cancela)──────────┴──┼──▶ cancelada
//                                            └── heartbeat parado > 10 min: outro ciclo do agente
//                                                reivindica de novo (agente anterior caiu no meio)
//
// Corrida: o padrão do projeto é índice único parcial (0037) ou UPDATE condicional — nada de
// função Postgres/`FOR UPDATE SKIP LOCKED` (sem precedente no repositório). Criar duas ativas na
// mesma competência morre no índice `uq_iss_solicitacoes_competencia_ativa` (23505); reivindicar
// a mesma solicitação duas vezes morre no `.eq('status', lido)` do UPDATE (0 linhas = perdeu).
import type { SolicitacaoIss, StatusSolicitacaoIss } from '@cobranca/shared';
import { STATUS_SOLICITACAO_ISS_ATIVOS } from '@cobranca/shared';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';
import type {
  ConclusaoSolicitacaoIssInput,
  ProgressoSolicitacaoIssInput,
} from '@/server/validation/iss-solicitacao-schema';

const TABELA = 'iss_solicitacoes';
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

/** Heartbeat parado há mais que isto numa solicitação `em_andamento` = o agente caiu no meio. */
export const HEARTBEAT_EXPIRADO_MS = 10 * 60_000;

export interface IssSolicitacaoRow {
  id: string;
  competencia: string;
  documentos: string[] | null;
  status: StatusSolicitacaoIss;
  solicitado_por: string;
  solicitado_em: string;
  iniciado_em: string | null;
  finalizado_em: string | null;
  progresso_atual: number | null;
  progresso_total: number | null;
  execucao_id: string | null;
  mensagem_erro: string | null;
  maquina: string | null;
  heartbeat_em: string | null;
}

export function toSolicitacaoIss(row: IssSolicitacaoRow): SolicitacaoIss {
  return {
    id: row.id,
    competencia: row.competencia,
    documentos: row.documentos,
    status: row.status,
    solicitadoPor: row.solicitado_por,
    solicitadoEm: row.solicitado_em,
    iniciadoEm: row.iniciado_em,
    finalizadoEm: row.finalizado_em,
    progressoAtual: row.progresso_atual,
    progressoTotal: row.progresso_total,
    execucaoId: row.execucao_id,
    mensagemErro: row.mensagem_erro,
    maquina: row.maquina,
    heartbeatEm: row.heartbeat_em,
  };
}

function erroDb(mensagem: string, error: { message: string }): ApiError {
  return new ApiError(500, mensagem, 'DB_ERROR', { error: error.message });
}

async function buscarPorId(id: string): Promise<IssSolicitacaoRow | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from(TABELA).select('*').eq('id', id).maybeSingle();
  if (error) throw erroDb('Falha ao buscar a solicitação do ISS', error);
  return (data as IssSolicitacaoRow | null) ?? null;
}

/** Solicitação `pendente`/`em_andamento` da competência (o índice único garante no máximo uma). */
export async function buscarSolicitacaoIssAtiva(competencia: string): Promise<SolicitacaoIss | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(TABELA)
    .select('*')
    .eq('competencia', competencia)
    .in('status', [...STATUS_SOLICITACAO_ISS_ATIVOS])
    .maybeSingle();
  if (error) throw erroDb('Falha ao buscar a solicitação ativa do ISS', error);
  return data ? toSolicitacaoIss(data as IssSolicitacaoRow) : null;
}

/**
 * O que a UI mostra para a competência (AC 8): a ATIVA, se houver; senão a mais recente de
 * qualquer status ("concluída às 10:42" continua visível depois de terminar); senão `null`.
 */
export async function buscarSolicitacaoIssDaCompetencia(competencia: string): Promise<SolicitacaoIss | null> {
  const ativa = await buscarSolicitacaoIssAtiva(competencia);
  if (ativa) return ativa;
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(TABELA)
    .select('*')
    .eq('competencia', competencia)
    .order('solicitado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw erroDb('Falha ao buscar a última solicitação do ISS', error);
  return data ? toSolicitacaoIss(data as IssSolicitacaoRow) : null;
}

/**
 * Cria a solicitação (AC 7). IDEMPOTENTE: já havendo uma ativa na competência, devolve ELA com
 * `criada: false`. A checagem prévia só evita o insert no caso comum — a barreira de verdade é o
 * índice único parcial, e a violação (23505) de uma corrida também devolve a que venceu.
 */
export async function criarSolicitacaoIss(input: {
  competencia: string;
  documentos?: string[] | null;
  solicitadoPor: string;
}): Promise<{ solicitacao: SolicitacaoIss; criada: boolean }> {
  const existente = await buscarSolicitacaoIssAtiva(input.competencia);
  if (existente) return { solicitacao: existente, criada: false };

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(TABELA)
    .insert({
      competencia: input.competencia,
      documentos: input.documentos && input.documentos.length > 0 ? input.documentos : null,
      status: 'pendente',
      solicitado_por: input.solicitadoPor,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      const vencedora = await buscarSolicitacaoIssAtiva(input.competencia);
      if (vencedora) return { solicitacao: vencedora, criada: false };
      // A outra terminou entre a violação e a releitura: raro o bastante para só pedir outra tentativa.
      throw new ApiError(409, 'Outra busca no ISS acabou de ser pedida — tente de novo', 'SOLICITACAO_CONCORRENTE');
    }
    throw erroDb('Falha ao registrar a solicitação do ISS', error);
  }
  return { solicitacao: toSolicitacaoIss(data as IssSolicitacaoRow), criada: true };
}

/** Cancela (AC 9) — só de `pendente`/`em_andamento`; outro status ⇒ 422 (nada a cancelar). */
export async function cancelarSolicitacaoIss(id: string, agora: Date = new Date()): Promise<SolicitacaoIss> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(TABELA)
    .update({ status: 'cancelada', finalizado_em: agora.toISOString() })
    .eq('id', id)
    .in('status', [...STATUS_SOLICITACAO_ISS_ATIVOS])
    .select('*');
  if (error) throw erroDb('Falha ao cancelar a solicitação do ISS', error);
  const linha = (data as IssSolicitacaoRow[] | null)?.[0];
  if (linha) return toSolicitacaoIss(linha);

  const atual = await buscarPorId(id);
  if (!atual) throw new ApiError(404, 'Solicitação não encontrada', 'NOT_FOUND');
  throw new ApiError(422, `Nada a cancelar: a solicitação já está ${atual.status}`, 'SOLICITACAO_NAO_ATIVA', {
    status: atual.status,
  });
}

/**
 * Reivindica a próxima solicitação para o agente (AC 10): a `pendente` mais antiga ou, sem
 * nenhuma, uma `em_andamento` com heartbeat parado há mais de 10 min. O UPDATE é condicional ao
 * status (e ao heartbeat, no caso da retomada) LIDO no SELECT: se outro ciclo chegou antes, 0
 * linhas ⇒ `null` e o agente tenta de novo no próximo ciclo. [AUTO-DECISION da story: só existe
 * um agente por vez na prática (G4), então perder a corrida custa só um ciclo de espera.]
 */
export async function reivindicarProximaSolicitacaoIss(
  maquina: string | null,
  agora: Date = new Date(),
): Promise<SolicitacaoIss | null> {
  const db = getSupabaseAdmin();

  const { data: pendente, error: errPendente } = await db
    .from(TABELA)
    .select('*')
    .eq('status', 'pendente')
    .order('solicitado_em', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (errPendente) throw erroDb('Falha ao buscar solicitação pendente do ISS', errPendente);

  let candidata = pendente as IssSolicitacaoRow | null;
  if (!candidata) {
    const limite = new Date(agora.getTime() - HEARTBEAT_EXPIRADO_MS).toISOString();
    const { data: abandonada, error: errAbandonada } = await db
      .from(TABELA)
      .select('*')
      .eq('status', 'em_andamento')
      .lt('heartbeat_em', limite)
      .order('solicitado_em', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (errAbandonada) throw erroDb('Falha ao buscar solicitação abandonada do ISS', errAbandonada);
    candidata = abandonada as IssSolicitacaoRow | null;
  }
  if (!candidata) return null;

  let update = db
    .from(TABELA)
    .update({
      status: 'em_andamento',
      heartbeat_em: agora.toISOString(),
      maquina,
      iniciado_em: candidata.iniciado_em ?? agora.toISOString(),
    })
    .eq('id', candidata.id)
    .eq('status', candidata.status);
  if (candidata.status === 'em_andamento' && candidata.heartbeat_em) {
    // Retomada: se o agente "abandonado" deu sinal de vida entre o SELECT e aqui, ele não é tomado.
    update = update.eq('heartbeat_em', candidata.heartbeat_em);
  }
  const { data, error } = await update.select('*');
  if (error) throw erroDb('Falha ao reivindicar a solicitação do ISS', error);
  const linha = (data as IssSolicitacaoRow[] | null)?.[0];
  return linha ? toSolicitacaoIss(linha) : null;
}

/**
 * UPDATE só se a solicitação ainda está `em_andamento`. 0 linhas ⇒ 404 (não existe) ou 409 (foi
 * cancelada/concluída no meio — o agente deve parar).
 */
async function atualizarEmAndamento(
  id: string,
  campos: Record<string, unknown>,
  acao: string,
): Promise<SolicitacaoIss> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(TABELA)
    .update(campos)
    .eq('id', id)
    .eq('status', 'em_andamento')
    .select('*');
  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      throw new ApiError(422, 'Execução informada não existe', 'EXECUCAO_INVALIDA');
    }
    throw erroDb(`Falha ao ${acao} a solicitação do ISS`, error);
  }
  const linha = (data as IssSolicitacaoRow[] | null)?.[0];
  if (linha) return toSolicitacaoIss(linha);

  const atual = await buscarPorId(id);
  if (!atual) throw new ApiError(404, 'Solicitação não encontrada', 'NOT_FOUND');
  throw new ApiError(
    409,
    `A solicitação não está em andamento (status: ${atual.status})`,
    'SOLICITACAO_NAO_EM_ANDAMENTO',
    { status: atual.status },
  );
}

/** Progresso por empresa (AC 11) — também é o heartbeat. */
export function registrarProgressoSolicitacaoIss(
  id: string,
  progresso: ProgressoSolicitacaoIssInput,
  agora: Date = new Date(),
): Promise<SolicitacaoIss> {
  return atualizarEmAndamento(
    id,
    { progresso_atual: progresso.atual, progresso_total: progresso.total, heartbeat_em: agora.toISOString() },
    'registrar o progresso da',
  );
}

/** Conclusão (AC 12): `{ execucaoId }` ⇒ concluida; `{ erro }` ⇒ falhou. */
export function concluirSolicitacaoIss(
  id: string,
  conclusao: ConclusaoSolicitacaoIssInput,
  agora: Date = new Date(),
): Promise<SolicitacaoIss> {
  const campos =
    'execucaoId' in conclusao
      ? { status: 'concluida', execucao_id: conclusao.execucaoId, finalizado_em: agora.toISOString() }
      : { status: 'falhou', mensagem_erro: conclusao.erro, finalizado_em: agora.toISOString() };
  return atualizarEmAndamento(id, { ...campos, heartbeat_em: agora.toISOString() }, 'concluir');
}

/**
 * Guarda de `POST /api/integracoes/iss/execucoes` (AC 13): a execução diz atender uma
 * solicitação — ela precisa existir e estar `em_andamento`. Só confere; não muda estado nenhum.
 */
export async function exigirSolicitacaoIssEmAndamento(id: string): Promise<void> {
  const atual = await buscarPorId(id);
  if (!atual || atual.status !== 'em_andamento') {
    throw new ApiError(
      422,
      atual
        ? `A solicitação ${id} não está em andamento (status: ${atual.status})`
        : `Solicitação ${id} não encontrada`,
      'SOLICITACAO_INVALIDA',
      { solicitacaoId: id, status: atual?.status ?? null },
    );
  }
}
