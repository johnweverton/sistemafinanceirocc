// Mapeadores entre as linhas do Postgres (snake_case) e os tipos de domínio (camelCase).
import type {
  Medico,
  MedicoHistorico,
  Execucao,
  ExecucaoResultado,
  Subtotal,
} from '@cobranca/shared';

export interface MedicoRow {
  id: string;
  cpf: string;
  nome: string;
  especialidade: string | null;
  status_hapvida: Medico['statusHapvida'];
  faz_outros_hospitais: boolean;
  faz_imobilizacoes: boolean;
  modo_mudanca_data: Medico['modoMudancaData'];
  colaborador_responsavel: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
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
    colaboradorResponsavel: row.colaborador_responsavel,
    ativo: row.ativo,
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
    colaboradorResponsavel: 'colaborador_responsavel',
    ativo: 'ativo',
  };
  const row: Partial<MedicoRow> = {};
  for (const [campo, valor] of Object.entries(dados)) {
    const col = map[campo];
    if (col) (row as Record<string, unknown>)[col] = valor;
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
  };
}
