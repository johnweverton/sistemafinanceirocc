// Relatórios financeiros (Excel/PDF + BI público via link com token) — Módulo de Relatórios.
import type { ContaEmissora } from './conta-emissora';
import type { TipoServico } from './tipo-servico';
import type { Recebivel } from './recebivel';

export interface SubtotalRelatorio {
  qtd: number;
  totalEmitido: number;
  totalPago: number;
  totalEmAberto: number;
  totalVencido: number;
  /** Rastreado à parte — nunca somado em totalEmitido (mesma regra da migration 0043). */
  totalCancelado: number;
}

export interface GrupoRelatorioRecebiveis {
  contaEmissora: ContaEmissora;
  contaEmissoraLabel: string;
  linhas: Recebivel[];
  subtotal: SubtotalRelatorio;
}

export interface RelatorioRecebiveis {
  filtro: { competencia?: string; contaEmissora?: ContaEmissora; tipoServico?: TipoServico };
  geradoEm: string;
  grupos: GrupoRelatorioRecebiveis[];
  totalGeral: SubtotalRelatorio;
}

// ---- Link público do BI ----

export interface RelatorioLink {
  id: string;
  token: string;
  nome: string;
  escopoContaEmissora: ContaEmissora | null;
  criadoPor: string;
  criadoEm: string;
  expiraEm: string | null;
  revogadoEm: string | null;
  ultimoAcessoEm: string | null;
}

export interface CriarRelatorioLinkInput {
  nome: string;
  escopoContaEmissora?: ContaEmissora;
  expiraEm?: string;
}

// ---- Payload agregado do BI público (nunca tem nome de médico, boletoId ou idExterno) ----

export interface KpiRelatorioPublico {
  competencia: string | null;
  qtdBoletos: number;
  totalEmitido: number;
  totalRecebido: number;
  totalEmAberto: number;
  totalVencido: number;
  taxaInadimplencia: number;
}

export interface PorEmpresaRelatorioPublico {
  contaEmissora: ContaEmissora;
  contaEmissoraLabel: string;
  totalEmitido: number;
  totalRecebido: number;
  totalEmAberto: number;
  totalVencido: number;
}

/** Cobrança Médica vs Contabilidade agregado (migration 0050) — nunca tem nome de cliente. */
export interface PorTipoServicoRelatorioPublico {
  tipoServico: TipoServico;
  tipoServicoLabel: string;
  totalEmitido: number;
  totalRecebido: number;
  totalEmAberto: number;
  totalVencido: number;
}

export interface RelatorioPublicoResposta {
  nomeLink: string;
  escopoContaEmissora: ContaEmissora | null;
  competenciasDisponiveis: string[];
  kpi: KpiRelatorioPublico;
  evolucaoMensal: KpiRelatorioPublico[];
  porEmpresa: PorEmpresaRelatorioPublico[];
  porTipoServico: PorTipoServicoRelatorioPublico[];
  aging: { faixa: string; qtd: number; total: number }[];
  geradoEm: string;
}
