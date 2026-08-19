// Agregações do Dashboard financeiro (Épico 4, Story 4.5). Derivam das views vw_dashboard_*.
import type { ContaEmissora } from './conta-emissora';
import type { TipoServico } from './tipo-servico';

export interface ResumoCompetencia {
  competencia: string | null; // null = linha de rollup (total geral / "Todas")
  qtdBoletos: number;
  totalEmitido: number;
  totalRecebido: number;
  totalEmAberto: number;
  totalVencido: number;
  taxaInadimplencia: number; // razão 0..1
}

export interface ResumoMedico {
  medicoId: string | null;
  nome: string;
  qtdBoletos: number;
  totalEmitido: number;
  totalRecebido: number;
  totalEmAberto: number;
  totalVencido: number;
  taxaInadimplencia: number;
  ticketMedio: number;
}

export interface AgingFaixa {
  faixa: string; // '0-30' | '31-60' | '60+'
  qtd: number;
  total: number;
}

/** Resumo por empresa (conta emissora) — Módulo de Relatórios. */
export interface ResumoPorEmpresa {
  contaEmissora: ContaEmissora;
  competencia: string | null; // null = rollup (todas as competências)
  qtdBoletos: number;
  totalEmitido: number;
  totalRecebido: number;
  totalEmAberto: number;
  totalVencido: number;
  taxaInadimplencia: number;
}

/**
 * Resumo por tipo de serviço (Cobrança Médica vs Contabilidade, migration 0050) — mesmo
 * grouping set (competencia, tipo_servico) de vw_dashboard_competencia, isolado por
 * tipo_servico (nunca NULL). Espelha ResumoPorEmpresa, mas no eixo tipo_servico.
 */
export interface ResumoPorTipoServico {
  tipoServico: TipoServico;
  competencia: string | null; // null = rollup (todas as competências)
  qtdBoletos: number;
  totalEmitido: number;
  totalRecebido: number;
  totalEmAberto: number;
  totalVencido: number;
  taxaInadimplencia: number;
}

/**
 * Um médico com boletos vencidos — visão gerencial de inadimplência do Dashboard (BI CEO).
 * Agrupado no cliente a partir de `vw_recebiveis` (status_derivado='vencido'), não é uma view
 * nova: reusa exatamente os mesmos dados já servidos por `/recebiveis`.
 */
export interface InadimplenteMedico {
  medicoId: string | null;
  nome: string;
  qtdVencidos: number;
  totalVencido: number;
  vencimentoMaisAntigo: string | null; // ISO date (YYYY-MM-DD) do boleto vencido há mais tempo
  diasAtrasoMax: number; // dias corridos desde vencimentoMaisAntigo até hoje
}
