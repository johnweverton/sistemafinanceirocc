// Mapeadores entre as linhas do Postgres (snake_case) e os tipos de domínio (camelCase).
import type { Medico, MedicoHistorico } from '@cobranca/shared';

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
