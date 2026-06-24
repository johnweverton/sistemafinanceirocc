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
}
