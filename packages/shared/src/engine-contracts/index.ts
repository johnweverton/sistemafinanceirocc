// Contratos de entrada/saída do motor (Engine). Funções puras, sem I/O.
import type { Medico } from '../types/medico';
import type { ExecucaoResultado, Subtotal } from '../types/execucao';

/** Resultado da contagem de guias (PRD §5.2). */
export interface ResultadoContagem {
  guias: number;
  cirurgias: number;
}

export type ModoObservado = 'sim' | 'nao';

/** Resultado de uma faixa aplicada a uma classe. `valor` null = fora da tabela (PRD §5.1). */
export interface ResultadoFaixa {
  valor: number | null;
  faixa: string;
}

import type { ItemProducao } from '../types/integracao';

/** Entrada do processamento de um médico — dados já buscados (sem I/O no Engine). */
export interface EntradaProcessamentoMedico {
  medico: Pick<
    Medico,
    | 'id'
    | 'cpf'
    | 'nome'
    | 'statusHapvida'
    | 'fazOutrosHospitais'
    | 'fazImobilizacoes'
    | 'modoMudancaData'
    | 'especialidade'
  >;
  itens: ItemProducao[];
  /** Guias da execução anterior do mesmo médico, p/ detecção de variação anômala (PRD §8.5). */
  historicoGuias?: number | null;
}

/** Resultado puro do Engine — sem ids de banco (preenchidos pelo orquestrador ao persistir). */
export interface ResultadoMedico {
  cpf: string;
  nome: string;
  procedimentos: number;
  cirurgias: number;
  guias: number;
  guiasConsolidado: number;
  subtotais: Subtotal[];
  totalValor: number;
  status: ExecucaoResultado['status'];
  alertas: string[];
}
