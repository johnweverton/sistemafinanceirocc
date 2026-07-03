// Agregações do Dashboard financeiro (Épico 4, Story 4.5). Derivam das views vw_dashboard_*.

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
