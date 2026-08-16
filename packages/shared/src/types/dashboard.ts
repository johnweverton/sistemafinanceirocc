// Agregações do Dashboard financeiro (Épico 4, Story 4.5). Derivam das views vw_dashboard_*.
import type { ContaEmissora } from './conta-emissora';

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
