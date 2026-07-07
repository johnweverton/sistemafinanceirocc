// Domínio: Médico — fonte única de verdade dos parâmetros de faturamento.
// Derivado da arquitetura (Data Models) e do PRD §5.1 / §7.

export type StatusHapvida = 'credenciado' | 'nao_credenciado' | 'nenhum';
export type ModoMudancaData = 'sim' | 'nao';

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
 * Regra única de completude de cobrança: retorna true somente quando o bloco existe e todos
 * os campos obrigatórios estão preenchidos (complemento é opcional), com documento coerente
 * ao tipo (CPF=11, CNPJ=14 dígitos). Reutilizado pela UI e pelo guard de emissão.
 */
export function cobrancaCompleta(m: Pick<Medico, 'cobranca'>): boolean {
  const c = m.cobranca;
  if (!c) return false;
  const obrigatorios = [
    c.pagadorTipo,
    c.pagadorDocumento,
    c.pagadorNome,
    c.email,
    c.cep,
    c.logradouro,
    c.numero,
    c.bairro,
    c.cidade,
    c.uf,
  ];
  if (obrigatorios.some((v) => !v || String(v).trim() === '')) return false;
  const tamDoc = c.pagadorDocumento.replace(/\D/g, '').length;
  if (c.pagadorTipo === 'PF' && tamDoc !== 11) return false;
  if (c.pagadorTipo === 'PJ' && tamDoc !== 14) return false;
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
