// Domínio: Empresa — agrega produção de vários médicos num boleto único (Story 10.4, Épico 10).
// Ver docs/stories/10.4.emissao-por-empresa-medisa.story.md para o desenho do @architect.
// Reaproveita deliberadamente os mesmos tipos já usados por Medico (DadosCobranca, RegraPreco,
// ContaEmissora, CondicoesCobranca) — a empresa não é um conceito novo de dados, é o mesmo
// domínio de cobrança aplicado a um agregado multi-médico em vez de a um médico só.
import type { ContaEmissora } from './conta-emissora';
import type { DadosCobranca, CondicoesCobranca, RegraPreco } from './medico';

export interface Empresa {
  id: string;
  nome: string;
  /** Dados de cobrança do pagador (tipicamente PJ — CNPJ, razão social). */
  cobranca: DadosCobranca | null;
  /** Conta Cora que emite os boletos desta empresa (mesmo domínio do Épico 7). */
  contaEmissora: ContaEmissora;
  /** Overrides comerciais; null/campos nulos herdam o padrão global (config_cobranca). */
  condicoes: CondicoesCobranca | null;
  /**
   * Regra de preço aplicada à produção agregada (Story 10.4b). MVP da agregação só suporta a
   * forma 'por_guia' — as demais formas geram alerta na execução, nunca chutam um rateio entre
   * médicos.
   */
  regraPreco: RegraPreco | null;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmpresaHistorico {
  id: string;
  empresaId: string;
  campoAlterado: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  alteradoPor: string;
  motivo: string | null;
  alteradoEm: string;
}
