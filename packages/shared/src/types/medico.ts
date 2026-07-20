// Domínio: Médico — fonte única de verdade dos parâmetros de faturamento.
// Derivado da arquitetura (Data Models) e do PRD §5.1 / §7.
import type { ContaEmissora } from './conta-emissora';

export type StatusHapvida = 'credenciado' | 'nao_credenciado' | 'nenhum';
export type ModoMudancaData = 'sim' | 'nao';

/**
 * Modo de cálculo da cobrança (Story 6.2, Épico 6; Story 10.1, Épico 10):
 *   - 'faixa_guias' (padrão): tabela de faixas por classe (PRD §5.1) — comportamento original.
 *   - 'percentual_producao': percentual × valor COBRADO da produção do mês (médicos auxiliares;
 *     GATE do dono 2026-07-08: base = charged_val, glosados entram, percentual por médico).
 *   - 'preco_proprio': regra de preço negociada fora da tabela de faixas (Story 10.1 — Dr. Jansen,
 *     Nelson, Carlos Batista, Jefferson). Exige `regraPreco` preenchida.
 */
export type ModoCobranca = 'faixa_guias' | 'percentual_producao' | 'preco_proprio';

/**
 * Forma da regra de preço própria (Story 10.1, GATE do dono 2026-07-20):
 *   - 'base_excedente': `valor = base + max(0, guias − limiar) × taxa` (Dr. Jansen: base ~935,62,
 *     limiar 144, taxa 6,50).
 *   - 'fixo': valor mensal fixo, independe da quantidade de guias (Nelson, Carlos Batista,
 *     R$591,22; Jefferson, R$130,53).
 * Nefrologia/"guias cardíacas" NÃO entram aqui — são agrupamento de produção por empresa
 * (MEDISA), tratado na Story 10.4, não um override de médico individual.
 */
export type RegraPrecoForma = 'base_excedente' | 'fixo';

/** Regra de preço própria por médico — editável sem deploy (linha, não código). */
export interface RegraPreco {
  forma: RegraPrecoForma;
  /** Valor base antes do excedente. Obrigatório na forma 'base_excedente'. */
  base: number | null;
  /** Guias a partir das quais o excedente por guia incide. Obrigatório na forma 'base_excedente'. */
  limiar: number | null;
  /** Valor por guia acima do limiar. Obrigatório na forma 'base_excedente'. */
  taxa: number | null;
  /** Valor fixo mensal, independe de guias. Obrigatório na forma 'fixo'. */
  valorFixo: number | null;
}

/** Tipo de pessoa do pagador do boleto — independente do CPF-chave do médico. */
export type PagadorTipo = 'PF' | 'PJ';

/**
 * Dados de cobrança do pagador — exigidos pela API do Cora para emitir boleto registrado.
 * `pagadorDocumento` é o CPF (11) ou CNPJ (14) do pagador, distinto de `Medico.cpf`
 * (que segue como chave de cruzamento com a API da Carmem).
 */
export interface DadosCobranca {
  pagadorTipo: PagadorTipo;
  pagadorDocumento: string; // 11 (CPF) ou 14 (CNPJ) dígitos, sem pontuação
  pagadorNome: string; // nome ou razão social
  email: string;
  cep: string; // 8 dígitos
  logradouro: string;
  numero: string;
  complemento: string | null; // único opcional
  bairro: string;
  cidade: string;
  uf: string; // sigla de 2 letras
  whatsapp?: string | null; // número ou ID do grupo para disparo
}

/**
 * Condições comerciais opcionais por médico (overrides). Cada campo nulo herda o default
 * global de `config_cobranca` na resolução da emissão.
 */
export interface CondicoesCobranca {
  diasVencimento: number | null;
  multaPercent: number | null;
  jurosMesPercent: number | null;
  descontoPercent: number | null;
  descontoDias: number | null;
}

export interface Medico {
  id: string;
  /**
   * CPF (11 dígitos, sem pontuação). Desde o Épico 5 (§3.4 da arquitetura) é dado
   * CADASTRAL, não chave interna: null = médico importado da origem, pendência de
   * cadastro. A chave de vínculo com a origem é `externalId`.
   */
  cpf: string | null;
  nome: string;
  especialidade: string | null;
  statusHapvida: StatusHapvida;
  fazOutrosHospitais: boolean;
  fazImobilizacoes: boolean;
  modoMudancaData: ModoMudancaData; // trava de conferência, NÃO entra no cálculo (PRD §5.3)
  /** Modo de cálculo da cobrança (Story 6.2). Default 'faixa_guias' — comportamento original. */
  modoCobranca: ModoCobranca;
  /** Percentual sobre o valor cobrado da produção (ex.: 5 = 5%). Obrigatório no modo percentual. */
  percentualProducao: number | null;
  /** Regra de preço própria (Story 10.1). Obrigatória quando modoCobranca = 'preco_proprio'. */
  regraPreco: RegraPreco | null;
  /** Conta Cora que emite os boletos deste médico (Épico 7). Backfill: 'mc'. */
  contaEmissora: ContaEmissora;
  colaboradorResponsavel: string | null;
  ativo: boolean;
  /** true = médico auto-descoberto, parâmetros de faturamento ainda não configurados. */
  necessitaConfiguracao: boolean;
  /** UUID do médico na origem (fin-clientes.id) — vínculo permanente; null/ausente = sem vínculo (Épico 5). */
  externalId?: string | null;
  /** Bloco de cobrança do pagador; null enquanto não configurado (Fase 3). */
  cobranca?: DadosCobranca | null;
  /** Overrides comerciais; null/campos nulos herdam config_cobranca global. */
  condicoes?: CondicoesCobranca | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Regra MÍNIMA para emitir boleto (Épico 6, gate revisado): a Cora só exige documento e
 * nome/razão social do pagador — e-mail e endereço são opcionais no payload da API.
 * Usada como guard bloqueante em POST /api/boletos/emitir.
 */
export function cobrancaMinimaEmissao(m: Pick<Medico, 'cobranca'>): boolean {
  const c = m.cobranca;
  if (!c) return false;
  const obrigatorios = [c.pagadorTipo, c.pagadorDocumento, c.pagadorNome];
  if (obrigatorios.some((v) => !v || String(v).trim() === '')) return false;
  const tamDoc = c.pagadorDocumento.replace(/\D/g, '').length;
  if (c.pagadorTipo === 'PF' && tamDoc !== 11) return false;
  if (c.pagadorTipo === 'PJ' && tamDoc !== 14) return false;
  return true;
}

/**
 * Regra de CADASTRO COMPLETO: mínimo pra emitir + e-mail + WhatsApp (contato necessário
 * pro disparo automático do boleto). Endereço NÃO entra mais aqui — a Cora não exige pra
 * emitir boleto registrado. Não bloqueia emissão; só sinaliza cadastro incompleto na UI
 * (Status 'cobranca_incompleta' em MedicosManager). Reutilizado pela UI e pelo guard de emissão.
 */
export function cobrancaCompleta(m: Pick<Medico, 'cobranca'>): boolean {
  if (!cobrancaMinimaEmissao(m)) return false;
  const c = m.cobranca!;
  if (!c.email || String(c.email).trim() === '') return false;
  if (!c.whatsapp || String(c.whatsapp).trim() === '') return false;
  return true;
}

// TIPO é derivado, nunca persistido como campo editável (PRD §5.1, §8.2).
export type TipoMedico = 1 | 2 | 3 | 4 | 5;

/**
 * Calcula o TIPO do médico a partir de status_hapvida + faz_outros_hospitais.
 * PRD §5.1:
 *   TIPO 1: não credenciado Hapvida (sem outros hospitais)
 *   TIPO 2: credenciado Hapvida (sem outros hospitais)
 *   TIPO 3: somente outros hospitais (sem Hapvida)
 *   TIPO 4: credenciado Hapvida + outros hospitais
 *   TIPO 5: não credenciado Hapvida + outros hospitais
 * Combinação inválida (nenhum status Hapvida e sem outros hospitais) lança erro (PRD §8.2).
 */
export function tipoDoMedico(
  m: Pick<Medico, 'statusHapvida' | 'fazOutrosHospitais'>,
): TipoMedico {
  const { statusHapvida: s, fazOutrosHospitais: outros } = m;
  if (s === 'nenhum' && !outros) {
    throw new Error('Combinação inválida: sem Hapvida e sem outros hospitais');
  }
  if (s === 'nao_credenciado' && !outros) return 1;
  if (s === 'credenciado' && !outros) return 2;
  if (s === 'nenhum' && outros) return 3;
  if (s === 'credenciado' && outros) return 4;
  return 5; // nao_credenciado && outros
}

/** Combinação válida de status_hapvida + faz_outros_hospitais (espelha a CHECK do banco). */
export function combinacaoClasseValida(
  m: Pick<Medico, 'statusHapvida' | 'fazOutrosHospitais'>,
): boolean {
  return !(m.statusHapvida === 'nenhum' && !m.fazOutrosHospitais);
}

export interface MedicoHistorico {
  id: string;
  medicoId: string;
  campoAlterado: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  alteradoPor: string; // user id (profiles.id)
  motivo: string | null;
  alteradoEm: string;
}
