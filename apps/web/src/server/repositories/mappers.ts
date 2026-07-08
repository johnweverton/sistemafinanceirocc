// Mapeadores entre as linhas do Postgres (snake_case) e os tipos de domínio (camelCase).
import type {
  Medico,
  MedicoHistorico,
  Execucao,
  ExecucaoResultado,
  ExecucaoResumoMedico,
  ExecucaoHistoricoMedicoItem,
  Subtotal,
  Boleto,
  BoletoEvento,
  Recebivel,
  StatusRecebivel,
  ResumoCompetencia,
  ResumoMedico,
  AgingFaixa,
} from '@cobranca/shared';

export interface MedicoRow {
  id: string;
  cpf: string | null; // nullable desde a migration 0011 (médico importado sem CPF)
  nome: string;
  especialidade: string | null;
  status_hapvida: Medico['statusHapvida'];
  faz_outros_hospitais: boolean;
  faz_imobilizacoes: boolean;
  modo_mudanca_data: Medico['modoMudancaData'];
  /** Modo de cobrança (migration 0018) — opcional em bancos sem a migration aplicada. */
  modo_cobranca?: Medico['modoCobranca'] | null;
  percentual_producao?: number | null;
  colaborador_responsavel: string | null;
  ativo: boolean;
  necessita_configuracao: boolean;
  /** Vínculo com a origem (migration 0011) — ausente em bancos sem a migration aplicada. */
  external_id?: string | null;
  // Dados de cobrança (migration 0006) — todas nullable.
  pagador_tipo: 'PF' | 'PJ' | null;
  pagador_documento: string | null;
  pagador_nome: string | null;
  email: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  // Overrides comerciais (migration 0006) — nullable.
  dias_vencimento: number | null;
  multa_percent: number | null;
  juros_mes_percent: number | null;
  desconto_percent: number | null;
  desconto_dias: number | null;
  created_at: string;
  updated_at: string;
}

/** Monta o bloco de cobrança; null se não há sinal de configuração (pagador_tipo ausente). */
function toDadosCobranca(row: MedicoRow): Medico['cobranca'] {
  if (!row.pagador_tipo) return null;
  return {
    pagadorTipo: row.pagador_tipo,
    pagadorDocumento: row.pagador_documento ?? '',
    pagadorNome: row.pagador_nome ?? '',
    email: row.email ?? '',
    cep: row.cep ?? '',
    logradouro: row.logradouro ?? '',
    numero: row.numero ?? '',
    complemento: row.complemento,
    bairro: row.bairro ?? '',
    cidade: row.cidade ?? '',
    uf: row.uf ?? '',
  };
}

/** Overrides comerciais; null se nenhum campo definido (todos herdam o global). */
function toCondicoes(row: MedicoRow): Medico['condicoes'] {
  const algum =
    row.dias_vencimento != null ||
    row.multa_percent != null ||
    row.juros_mes_percent != null ||
    row.desconto_percent != null ||
    row.desconto_dias != null;
  if (!algum) return null;
  return {
    diasVencimento: row.dias_vencimento,
    multaPercent: row.multa_percent,
    jurosMesPercent: row.juros_mes_percent,
    descontoPercent: row.desconto_percent,
    descontoDias: row.desconto_dias,
  };
}

export function toMedico(row: MedicoRow): Medico {
  return {
    id: row.id,
    cpf: row.cpf,
    nome: row.nome,
    especialidade: row.especialidade,
    statusHapvida: row.status_hapvida,
    fazOutrosHospitais: row.faz_outros_hospitais,
    fazImobilizacoes: row.faz_imobilizacoes,
    modoMudancaData: row.modo_mudanca_data,
    modoCobranca: row.modo_cobranca ?? 'faixa_guias', // default seguro pré-migration 0018
    percentualProducao: row.percentual_producao ?? null,
    colaboradorResponsavel: row.colaborador_responsavel,
    ativo: row.ativo,
    necessitaConfiguracao: row.necessita_configuracao ?? false,
    externalId: row.external_id ?? null,
    cobranca: toDadosCobranca(row),
    condicoes: toCondicoes(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface MedicoHistoricoRow {
  id: string;
  medico_id: string;
  campo_alterado: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  alterado_por: string;
  motivo: string | null;
  alterado_em: string;
}

export function toMedicoHistorico(row: MedicoHistoricoRow): MedicoHistorico {
  return {
    id: row.id,
    medicoId: row.medico_id,
    campoAlterado: row.campo_alterado,
    valorAnterior: row.valor_anterior,
    valorNovo: row.valor_novo,
    alteradoPor: row.alterado_por,
    motivo: row.motivo,
    alteradoEm: row.alterado_em,
  };
}

/** Campos de domínio (camelCase) → colunas do banco (snake_case), só os presentes. */
export function medicoUpdateToRow(dados: Partial<Medico>): Partial<MedicoRow> {
  const map: Record<string, keyof MedicoRow> = {
    cpf: 'cpf',
    nome: 'nome',
    especialidade: 'especialidade',
    statusHapvida: 'status_hapvida',
    fazOutrosHospitais: 'faz_outros_hospitais',
    fazImobilizacoes: 'faz_imobilizacoes',
    modoMudancaData: 'modo_mudanca_data',
    modoCobranca: 'modo_cobranca',
    percentualProducao: 'percentual_producao',
    colaboradorResponsavel: 'colaborador_responsavel',
    ativo: 'ativo',
    necessitaConfiguracao: 'necessita_configuracao',
  };
  const row: Partial<MedicoRow> = {};
  for (const [campo, valor] of Object.entries(dados)) {
    // Blocos aninhados são achatados separadamente abaixo.
    if (campo === 'cobranca' || campo === 'condicoes') continue;
    const col = map[campo];
    if (col) (row as Record<string, unknown>)[col] = valor;
  }

  // Achata o bloco de cobrança (camelCase → snake_case).
  if (dados.cobranca) {
    const c = dados.cobranca;
    Object.assign(row, {
      pagador_tipo: c.pagadorTipo,
      pagador_documento: c.pagadorDocumento,
      pagador_nome: c.pagadorNome,
      email: c.email,
      cep: c.cep,
      logradouro: c.logradouro,
      numero: c.numero,
      complemento: c.complemento,
      bairro: c.bairro,
      cidade: c.cidade,
      uf: c.uf,
    } satisfies Partial<MedicoRow>);
  }

  // Achata os overrides comerciais.
  if (dados.condicoes) {
    const o = dados.condicoes;
    Object.assign(row, {
      dias_vencimento: o.diasVencimento,
      multa_percent: o.multaPercent,
      juros_mes_percent: o.jurosMesPercent,
      desconto_percent: o.descontoPercent,
      desconto_dias: o.descontoDias,
    } satisfies Partial<MedicoRow>);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export interface ExecucaoRow {
  id: string;
  competencia: string;
  iniciado_por: string;
  iniciado_em: string;
  finalizado_em: string | null;
  status: Execucao['status'];
  progresso: number;
  total_medicos: number | null;
  total_ok: number | null;
  total_alerta: number | null;
  total_sem_dados: number | null;
  total_geral_valor: number | null;
}

export function toExecucao(row: ExecucaoRow): Execucao {
  return {
    id: row.id,
    competencia: row.competencia,
    iniciadoPor: row.iniciado_por,
    iniciadoEm: row.iniciado_em,
    finalizadoEm: row.finalizado_em,
    status: row.status,
    progresso: row.progresso,
    totalMedicos: row.total_medicos,
    totalOk: row.total_ok,
    totalAlerta: row.total_alerta,
    totalSemDados: row.total_sem_dados,
    totalGeralValor: row.total_geral_valor,
  };
}

export interface ExecucaoSelecaoRow {
  execucao_id: string;
  medico_id: string;
  producao_externa_id: string;
  producao_nome: string;
}

export function toExecucaoSelecaoRow(selecao: { execucaoId: string; medicoId: string; producaoExternaId: string; producaoNome: string }): ExecucaoSelecaoRow {
  return {
    execucao_id: selecao.execucaoId,
    medico_id: selecao.medicoId,
    producao_externa_id: selecao.producaoExternaId,
    producao_nome: selecao.producaoNome,
  };
}

export function toExecucaoSelecao(row: ExecucaoSelecaoRow) {
  return {
    execucaoId: row.execucao_id,
    medicoId: row.medico_id,
    producaoExternaId: row.producao_externa_id,
    producaoNome: row.producao_nome,
  };
}

export interface ExecucaoResultadoRow {
  id: string;
  execucao_id: string;
  medico_id: string | null;
  cpf: string;
  nome: string;
  procedimentos: number | null;
  cirurgias: number | null;
  guias: number | null;
  guias_consolidado: number | null;
  subtotais: Subtotal[] | null;
  total_valor: number | null;
  status: ExecucaoResultado['status'];
  alertas: string[] | null;
  status_original: ExecucaoResultado['status'] | null;
  revisado_por: string | null;
  revisado_em: string | null;
  motivo_revisao: string | null;
}

export function toExecucaoResultado(row: ExecucaoResultadoRow): ExecucaoResultado {
  return {
    id: row.id,
    execucaoId: row.execucao_id,
    medicoId: row.medico_id,
    cpf: row.cpf,
    nome: row.nome,
    procedimentos: row.procedimentos,
    cirurgias: row.cirurgias,
    guias: row.guias,
    guiasConsolidado: row.guias_consolidado,
    subtotais: row.subtotais,
    totalValor: row.total_valor,
    status: row.status,
    alertas: row.alertas ?? [],
    statusOriginal: row.status_original ?? null,
    revisadoPor: row.revisado_por ?? null,
    revisadoEm: row.revisado_em ?? null,
    motivoRevisao: row.motivo_revisao ?? null,
  };
}

export interface ExecucaoResumoMedicoRow {
  medico_id: string | null;
  cpf: string;
  nome: string;
  ultima_competencia: string;
  ultima_execucao_id: string;
  ultima_execucao_status: Execucao['status'];
  ultimo_status_resultado: ExecucaoResultado['status'];
  ultimo_valor: number | null;
  qtd_execucoes: number;
}

export function toExecucaoResumoMedico(row: ExecucaoResumoMedicoRow): ExecucaoResumoMedico {
  return {
    medicoId: row.medico_id,
    cpf: row.cpf,
    nome: row.nome,
    ultimaCompetencia: row.ultima_competencia,
    ultimaExecucaoId: row.ultima_execucao_id,
    ultimaExecucaoStatus: row.ultima_execucao_status,
    ultimoStatusResultado: row.ultimo_status_resultado,
    ultimoValor: row.ultimo_valor,
    qtdExecucoes: row.qtd_execucoes,
  };
}

export interface ExecucaoHistoricoMedicoItemRow {
  execucao_id: string;
  status: ExecucaoResultado['status'];
  total_valor: number | null;
  execucoes: { competencia: string; status: Execucao['status']; iniciado_em: string };
}

export function toExecucaoHistoricoMedicoItem(
  row: ExecucaoHistoricoMedicoItemRow,
): ExecucaoHistoricoMedicoItem {
  return {
    execucaoId: row.execucao_id,
    competencia: row.execucoes.competencia,
    execucaoStatus: row.execucoes.status,
    statusResultado: row.status,
    totalValor: row.total_valor,
    iniciadoEm: row.execucoes.iniciado_em,
  };
}

// ---------------------------------------------------------------------------
// Boleto
// ---------------------------------------------------------------------------

export interface BoletoRow {
  id: string;
  execucao_resultado_id: string;
  gateway: Boleto['gateway'];
  id_externo: string | null;
  status: Boleto['status'];
  emitido_por: string;
  emitido_em: string;
  payload_resposta: unknown;
  // Baixa / conciliação (Épico 4)
  vencimento: string | null;
  pago_em: string | null;
  valor_pago: number | null;
  atualizado_em: string | null;
  // Cancelamento ativo (Story 6.1)
  cancelado_em: string | null;
  cancelado_por: string | null;
  motivo_cancelamento: string | null;
}

export function toBoleto(row: BoletoRow): Boleto {
  return {
    id: row.id,
    execucaoResultadoId: row.execucao_resultado_id,
    gateway: row.gateway,
    idExterno: row.id_externo,
    status: row.status,
    emitidoPor: row.emitido_por,
    emitidoEm: row.emitido_em,
    payloadResposta: row.payload_resposta,
    vencimento: row.vencimento ?? null,
    pagoEm: row.pago_em ?? null,
    valorPago: row.valor_pago ?? null,
    canceladoEm: row.cancelado_em ?? null,
    canceladoPor: row.cancelado_por ?? null,
    motivoCancelamento: row.motivo_cancelamento ?? null,
  };
}

export interface BoletoEventoRow {
  id: string;
  boleto_id: string | null;
  id_externo: string | null;
  evento_id: string | null;
  evento_tipo: string | null;
  status_reconsultado: string | null;
  payload: unknown;
  recebido_em: string;
}

export function toBoletoEvento(row: BoletoEventoRow): BoletoEvento {
  return {
    id: row.id,
    boletoId: row.boleto_id,
    idExterno: row.id_externo,
    eventoId: row.evento_id,
    eventoTipo: row.evento_tipo,
    statusReconsultado: row.status_reconsultado,
    payload: row.payload,
    recebidoEm: row.recebido_em,
  };
}

export interface RecebivelRow {
  boleto_id: string;
  execucao_resultado_id: string;
  id_externo: string | null;
  competencia: string;
  medico_id: string | null;
  nome: string;
  valor: number | null;
  vencimento: string | null;
  pago_em: string | null;
  valor_pago: number | null;
  emitido_em: string;
  status_derivado: StatusRecebivel;
}

export function toRecebivel(row: RecebivelRow): Recebivel {
  return {
    boletoId: row.boleto_id,
    execucaoResultadoId: row.execucao_resultado_id,
    idExterno: row.id_externo,
    competencia: row.competencia,
    medicoId: row.medico_id,
    nome: row.nome,
    valor: row.valor,
    vencimento: row.vencimento,
    pagoEm: row.pago_em,
    valorPago: row.valor_pago,
    emitidoEm: row.emitido_em,
    statusDerivado: row.status_derivado,
  };
}

// ---------------------------------------------------------------------------
// Dashboard (agregações — views vw_dashboard_*)
// ---------------------------------------------------------------------------
const num = (v: number | null | undefined): number => Number(v ?? 0);

export interface ResumoCompetenciaRow {
  competencia: string | null;
  qtd_boletos: number | null;
  total_emitido: number | null;
  total_recebido: number | null;
  total_em_aberto: number | null;
  total_vencido: number | null;
  taxa_inadimplencia: number | null;
}

export function toResumoCompetencia(row: ResumoCompetenciaRow): ResumoCompetencia {
  return {
    competencia: row.competencia,
    qtdBoletos: num(row.qtd_boletos),
    totalEmitido: num(row.total_emitido),
    totalRecebido: num(row.total_recebido),
    totalEmAberto: num(row.total_em_aberto),
    totalVencido: num(row.total_vencido),
    taxaInadimplencia: num(row.taxa_inadimplencia),
  };
}

export interface ResumoMedicoRow extends Omit<ResumoCompetenciaRow, 'competencia'> {
  medico_id: string | null;
  nome: string;
  ticket_medio: number | null;
}

export function toResumoMedico(row: ResumoMedicoRow): ResumoMedico {
  return {
    medicoId: row.medico_id,
    nome: row.nome,
    qtdBoletos: num(row.qtd_boletos),
    totalEmitido: num(row.total_emitido),
    totalRecebido: num(row.total_recebido),
    totalEmAberto: num(row.total_em_aberto),
    totalVencido: num(row.total_vencido),
    taxaInadimplencia: num(row.taxa_inadimplencia),
    ticketMedio: num(row.ticket_medio),
  };
}

export interface AgingFaixaRow {
  faixa: string;
  qtd: number | null;
  total: number | null;
}

export function toAgingFaixa(row: AgingFaixaRow): AgingFaixa {
  return { faixa: row.faixa, qtd: num(row.qtd), total: num(row.total) };
}
