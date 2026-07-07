// Execução de uma competência e o resultado agregado por médico.
// Derivado da arquitetura (Data Models) e do PRD §7.

export type StatusExecucao = 'processando' | 'concluido' | 'erro';
export type StatusResultado = 'ok' | 'alerta' | 'sem_dados';

export type Classe =
  | 'HAPVIDA_CRED'
  | 'HAPVIDA_NAO_CRED'
  | 'OUTROS_HOSPITAIS'
  | 'IMOBILIZACOES';

export interface Subtotal {
  classe: Classe;
  guias: number;
  valor: number;
  faixa: string;
}

export interface Execucao {
  id: string;
  competencia: string; // AAAA-MM
  iniciadoPor: string;
  /** E-mail resolvido via Admin Auth API — undefined/null se não foi possível resolver (não-fatal). */
  iniciadoPorEmail?: string | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
  status: StatusExecucao;
  progresso: number; // 0-100
  totalMedicos: number | null;
  totalOk: number | null;
  totalAlerta: number | null;
  totalSemDados: number | null;
  totalGeralValor: number | null;
}

export interface ExecucaoResultado {
  id: string;
  execucaoId: string;
  medicoId: string | null;
  cpf: string;
  nome: string;
  procedimentos: number | null;
  cirurgias: number | null;
  guias: number | null;
  guiasConsolidado: number | null;
  subtotais: Subtotal[] | null;
  totalValor: number | null;
  status: StatusResultado;
  alertas: string[];
  /** Status computado originalmente pelo engine — presente só quando o resultado foi revisado
   * manualmente (ex.: 'alerta' preservado enquanto `status` atual já é 'ok'). */
  statusOriginal?: StatusResultado | null;
  revisadoPor?: string | null;
  revisadoEm?: string | null;
  motivoRevisao?: string | null;
}

export interface ExecucaoSelecao {
  execucaoId: string;
  medicoId: string;
  producaoExternaId: string;
  producaoNome: string;
}

/** Um médico por linha: ocorrência mais recente em qualquer execução (visão "Por médico"). */
export interface ExecucaoResumoMedico {
  medicoId: string | null; // null quando o médico não estava vinculado ao cadastro na execução
  cpf: string;
  nome: string;
  ultimaCompetencia: string;
  ultimaExecucaoId: string;
  ultimaExecucaoStatus: StatusExecucao;
  ultimoStatusResultado: StatusResultado;
  ultimoValor: number | null;
  qtdExecucoes: number;
}

/** Uma ocorrência no histórico de um médico ao longo das competências (drill-down). */
export interface ExecucaoHistoricoMedicoItem {
  execucaoId: string;
  competencia: string;
  execucaoStatus: StatusExecucao;
  statusResultado: StatusResultado;
  totalValor: number | null;
  iniciadoEm: string;
}
