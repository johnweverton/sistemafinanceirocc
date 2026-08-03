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
    | 'modoCobranca'
    | 'percentualProducao'
    | 'regraPreco'
  >;
  itens: ItemProducao[];
  /** Guias da execução anterior do mesmo médico, p/ detecção de variação anômala (PRD §8.5). */
  historicoGuias?: number | null;
  /**
   * Itens do lote separado de consultas ambulatoriais do pediatra (Story 10.2) — vem de uma
   * produção distinta da de `itens` (guias hospitalares), NUNCA a mesma (anti-dupla-contagem).
   * Ausente/vazio = médico sem componente de consultas nesta execução (comportamento atual).
   */
  itensConsultas?: ItemProducao[];
  /**
   * Itens do lote separado de OUTROS_HOSPITAIS (Story 10.5) — produção distinta de `itens`
   * (guias normais/Hapvida). `undefined` = lote não selecionado nesta execução (o Engine gera
   * alerta e NÃO cobra a classe, nunca reaproveita a contagem de `itens`). Array presente
   * (mesmo vazio) = lote selecionado e contado normalmente.
   */
  itensOutrosHospitais?: ItemProducao[];
  /** Mesmo mecanismo acima, para o lote de IMOBILIZACOES (Story 10.5). */
  itensImobilizacoes?: ItemProducao[];
  /**
   * Competência da execução (AAAA-MM) — Story 10.6. Usada SÓ para filtrar `itensOutrosHospitais`
   * pelo mês real do item (`item.data`): na origem, "Outros Hospitais" não abre uma produção por
   * mês como o lote principal, um único lote acumula vários meses. Opcional (comportamento
   * pré-10.6 preservado quando ausente) — o orquestrador real sempre a informa; testes de
   * unidade do Engine que não exercitam este filtro podem omitir.
   */
  competencia?: string;
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
