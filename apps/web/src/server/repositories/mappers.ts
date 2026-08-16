// Mapeadores entre as linhas do Postgres (snake_case) e os tipos de domínio (camelCase).
import type {
  Medico,
  MedicoHistorico,
  Empresa,
  EmpresaHistorico,
  ClienteContabilidade,
  ClienteContabilidadeHistorico,
  ClienteContabilidadeFaturamento,
  DadosCobranca,
  CondicoesCobranca,
  RegraPreco,
  Execucao,
  ExecucaoResultado,
  ExecucaoResultadoContribuicao,
  ExecucaoResumoMedico,
  ExecucaoHistoricoMedicoItem,
  Subtotal,
  Boleto,
  BoletoEvento,
  Recebivel,
  StatusRecebivel,
  ResumoCompetencia,
  ResumoMedico,
  ResumoPorEmpresa,
  AgingFaixa,
  ExtratoTransacao,
  PlanoContas,
  RegraCategorizacao,
  LancamentoManual,
  LoteEmissao,
  LoteEmissaoItem,
  RelatorioLink,
} from '@cobranca/shared';

/** Colunas de cobrança compartilhadas por `medicos` e `empresas` (mesmo formato, migration 0006/0028). */
interface CobrancaRowFields {
  pagador_tipo: 'PF' | 'PJ' | null;
  pagador_documento: string | null;
  pagador_nome: string | null;
  email: string | null;
  whatsapp: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/** Colunas de condições comerciais compartilhadas por `medicos` e `empresas`. */
interface CondicoesRowFields {
  dias_vencimento: number | null;
  multa_percent: number | null;
  juros_mes_percent: number | null;
  desconto_percent: number | null;
  desconto_dias: number | null;
}

/** Colunas de regra de preço própria compartilhadas por `medicos`, `empresas` e
 *  `clientes_contabilidade` (migration 0025/0027/0028/0030). Os 2 últimos campos só existem em
 *  `clientes_contabilidade` (forma 'faixa_faturamento', Story 11.1) — ausentes/`undefined` em
 *  `medicos`/`empresas`, tratado como `null` por `toRegraPreco`. */
interface RegraPrecoRowFields {
  regra_preco_forma?: RegraPreco['forma'] | null;
  regra_preco_base?: number | null;
  regra_preco_limiar?: number | null;
  regra_preco_taxa?: number | null;
  regra_preco_valor_fixo?: number | null;
  regra_preco_valor_abaixo_limiar?: number | null;
  regra_preco_valor_acima_limiar?: number | null;
}

export interface MedicoRow {
  id: string;
  cpf: string | null; // nullable desde a migration 0011 (médico importado sem CPF)
  nome: string;
  especialidade: string | null;
  status_hapvida: Medico['statusHapvida'];
  faz_outros_hospitais: boolean;
  faz_imobilizacoes: boolean;
  modo_mudanca_data: Medico['modoMudancaData'];
  /** Modo de cobrança (migration 0018) — opcional em bancos sem a migration aplicada. */
  modo_cobranca?: Medico['modoCobranca'] | null;
  percentual_producao?: number | null;
  /** Regra de preço própria (migration 0025) — opcional em bancos sem a migration aplicada. */
  regra_preco_forma?: NonNullable<Medico['regraPreco']>['forma'] | null;
  regra_preco_base?: number | null;
  regra_preco_limiar?: number | null;
  regra_preco_taxa?: number | null;
  regra_preco_valor_fixo?: number | null;
  /** Conta emissora (migration 0021) — opcional em bancos sem a migration aplicada. */
  conta_emissora?: Medico['contaEmissora'] | null;
  /** Vínculo com empresa de agrupamento (migration 0028, Story 10.4a) — opcional pré-migration. */
  empresa_grupo_id?: string | null;
  /** Contrato sem excedente por guia (migration 0039, Story 10.7) — opcional pré-migration. */
  sem_excedente_por_guia?: boolean | null;
  colaborador_responsavel: string | null;
  ativo: boolean;
  necessita_configuracao: boolean;
  /** Vínculo com a origem (migration 0011) — ausente em bancos sem a migration aplicada. */
  external_id?: string | null;
  // Dados de cobrança (migration 0006) — todas nullable.
  pagador_tipo: 'PF' | 'PJ' | null;
  pagador_documento: string | null;
  pagador_nome: string | null;
  email: string | null;
  whatsapp: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  // Overrides comerciais (migration 0006) — nullable.
  dias_vencimento: number | null;
  multa_percent: number | null;
  juros_mes_percent: number | null;
  desconto_percent: number | null;
  desconto_dias: number | null;
  created_at: string;
  updated_at: string;
}

/** Monta o bloco de cobrança; null se não há sinal de configuração (pagador_tipo ausente). */
function toDadosCobranca(row: CobrancaRowFields): DadosCobranca | null {
  if (!row.pagador_tipo) return null;
  return {
    pagadorTipo: row.pagador_tipo,
    pagadorDocumento: row.pagador_documento ?? '',
    pagadorNome: row.pagador_nome ?? '',
    email: row.email ?? '',
    whatsapp: row.whatsapp ?? null,
    cep: row.cep ?? '',
    logradouro: row.logradouro ?? '',
    numero: row.numero ?? '',
    complemento: row.complemento,
    bairro: row.bairro ?? '',
    cidade: row.cidade ?? '',
    uf: row.uf ?? '',
  };
}

/** Regra de preço própria; null se não configurada (médico segue faixa_guias/percentual). */
function toRegraPreco(row: RegraPrecoRowFields): RegraPreco | null {
  if (!row.regra_preco_forma) return null;
  return {
    forma: row.regra_preco_forma,
    base: row.regra_preco_base ?? null,
    limiar: row.regra_preco_limiar ?? null,
    taxa: row.regra_preco_taxa ?? null,
    valorFixo: row.regra_preco_valor_fixo ?? null,
    valorAbaixoLimiar: row.regra_preco_valor_abaixo_limiar ?? null,
    valorAcimaLimiar: row.regra_preco_valor_acima_limiar ?? null,
  };
}

/** Overrides comerciais; null se nenhum campo definido (todos herdam o global). */
function toCondicoes(row: CondicoesRowFields): CondicoesCobranca | null {
  const algum =
    row.dias_vencimento != null ||
    row.multa_percent != null ||
    row.juros_mes_percent != null ||
    row.desconto_percent != null ||
    row.desconto_dias != null;
  if (!algum) return null;
  return {
    diasVencimento: row.dias_vencimento,
    multaPercent: row.multa_percent,
    jurosMesPercent: row.juros_mes_percent,
    descontoPercent: row.desconto_percent,
    descontoDias: row.desconto_dias,
  };
}

export function toMedico(row: MedicoRow): Medico {
  return {
    id: row.id,
    cpf: row.cpf,
    nome: row.nome,
    especialidade: row.especialidade,
    statusHapvida: row.status_hapvida,
    fazOutrosHospitais: row.faz_outros_hospitais,
    fazImobilizacoes: row.faz_imobilizacoes,
    modoMudancaData: row.modo_mudanca_data,
    modoCobranca: row.modo_cobranca ?? 'faixa_guias', // default seguro pré-migration 0018
    percentualProducao: row.percentual_producao ?? null,
    regraPreco: toRegraPreco(row), // default seguro pré-migration 0025 (colunas ausentes = null)
    contaEmissora: row.conta_emissora ?? 'mc', // default seguro pré-migration 0021 (backfill)
    colaboradorResponsavel: row.colaborador_responsavel,
    ativo: row.ativo,
    necessitaConfiguracao: row.necessita_configuracao ?? false,
    externalId: row.external_id ?? null,
    cobranca: toDadosCobranca(row),
    condicoes: toCondicoes(row),
    empresaGrupoId: row.empresa_grupo_id ?? null,
    semExcedentePorGuia: row.sem_excedente_por_guia ?? false, // default seguro pré-migration 0039
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface MedicoHistoricoRow {
  id: string;
  medico_id: string;
  campo_alterado: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  alterado_por: string;
  motivo: string | null;
  alterado_em: string;
}

export function toMedicoHistorico(row: MedicoHistoricoRow): MedicoHistorico {
  return {
    id: row.id,
    medicoId: row.medico_id,
    campoAlterado: row.campo_alterado,
    valorAnterior: row.valor_anterior,
    valorNovo: row.valor_novo,
    alteradoPor: row.alterado_por,
    motivo: row.motivo,
    alteradoEm: row.alterado_em,
  };
}

/** Campos de domínio (camelCase) → colunas do banco (snake_case), só os presentes. */
export function medicoUpdateToRow(dados: Partial<Medico>): Partial<MedicoRow> {
  const map: Record<string, keyof MedicoRow> = {
    cpf: 'cpf',
    nome: 'nome',
    especialidade: 'especialidade',
    statusHapvida: 'status_hapvida',
    fazOutrosHospitais: 'faz_outros_hospitais',
    fazImobilizacoes: 'faz_imobilizacoes',
    modoMudancaData: 'modo_mudanca_data',
    modoCobranca: 'modo_cobranca',
    percentualProducao: 'percentual_producao',
    contaEmissora: 'conta_emissora',
    colaboradorResponsavel: 'colaborador_responsavel',
    ativo: 'ativo',
    necessitaConfiguracao: 'necessita_configuracao',
    empresaGrupoId: 'empresa_grupo_id',
    semExcedentePorGuia: 'sem_excedente_por_guia',
  };
  const row: Partial<MedicoRow> = {};
  for (const [campo, valor] of Object.entries(dados)) {
    // Blocos aninhados são achatados separadamente abaixo.
    if (campo === 'cobranca' || campo === 'condicoes' || campo === 'regraPreco') continue;
    const col = map[campo];
    if (col) (row as Record<string, unknown>)[col] = valor === '' ? null : valor;
  }

  // Achata o bloco de cobrança (camelCase → snake_case).
  if (dados.cobranca) {
    const c = dados.cobranca;
    Object.assign(row, {
      pagador_tipo: c.pagadorTipo,
      pagador_documento: c.pagadorDocumento,
      pagador_nome: c.pagadorNome,
      email: c.email || null,
      whatsapp: c.whatsapp || null,
      cep: c.cep || null,
      logradouro: c.logradouro || null,
      numero: c.numero || null,
      complemento: c.complemento || null,
      bairro: c.bairro || null,
      cidade: c.cidade || null,
      uf: c.uf || null,
    } satisfies Partial<MedicoRow>);
  }

  // Achata a regra de preço própria (Story 10.1). `undefined` = campo não enviado (não mexe);
  // `null` explícito = remove o override (volta pra faixa_guias/percentual); objeto = grava.
  if (dados.regraPreco !== undefined) {
    if (dados.regraPreco === null) {
      Object.assign(row, {
        regra_preco_forma: null,
        regra_preco_base: null,
        regra_preco_limiar: null,
        regra_preco_taxa: null,
        regra_preco_valor_fixo: null,
      } satisfies Partial<MedicoRow>);
    } else {
      const rp = dados.regraPreco;
      Object.assign(row, {
        regra_preco_forma: rp.forma,
        regra_preco_base: rp.base ?? null,
        regra_preco_limiar: rp.limiar ?? null,
        regra_preco_taxa: rp.taxa ?? null,
        regra_preco_valor_fixo: rp.valorFixo ?? null,
      } satisfies Partial<MedicoRow>);
    }
  }

  // Achata os overrides comerciais.
  if (dados.condicoes) {
    const o = dados.condicoes;
    Object.assign(row, {
      dias_vencimento: o.diasVencimento,
      multa_percent: o.multaPercent,
      juros_mes_percent: o.jurosMesPercent,
      desconto_percent: o.descontoPercent,
      desconto_dias: o.descontoDias,
    } satisfies Partial<MedicoRow>);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Empresa (Story 10.4a) — mesmo padrão de médico, reaproveitando os helpers de
// cobrança/condições/regra de preço acima (CobrancaRowFields/CondicoesRowFields/RegraPrecoRowFields).
// ---------------------------------------------------------------------------

export interface EmpresaRow extends CobrancaRowFields, CondicoesRowFields, RegraPrecoRowFields {
  id: string;
  nome: string;
  conta_emissora: Empresa['contaEmissora'];
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export function toEmpresa(row: EmpresaRow): Empresa {
  return {
    id: row.id,
    nome: row.nome,
    cobranca: toDadosCobranca(row),
    contaEmissora: row.conta_emissora,
    condicoes: toCondicoes(row),
    regraPreco: toRegraPreco(row),
    ativo: row.ativo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Campos de domínio (camelCase) → colunas do banco (snake_case), só os presentes. */
export function empresaUpdateToRow(dados: Partial<Empresa>): Partial<EmpresaRow> {
  const map: Record<string, keyof EmpresaRow> = {
    nome: 'nome',
    contaEmissora: 'conta_emissora',
    ativo: 'ativo',
  };
  const row: Partial<EmpresaRow> = {};
  for (const [campo, valor] of Object.entries(dados)) {
    if (campo === 'cobranca' || campo === 'condicoes' || campo === 'regraPreco') continue;
    const col = map[campo];
    if (col) (row as Record<string, unknown>)[col] = valor === '' ? null : valor;
  }

  if (dados.cobranca !== undefined) {
    if (dados.cobranca === null) {
      Object.assign(row, {
        pagador_tipo: null, pagador_documento: null, pagador_nome: null, email: null,
        whatsapp: null, cep: null, logradouro: null, numero: null, complemento: null,
        bairro: null, cidade: null, uf: null,
      } satisfies Partial<EmpresaRow>);
    } else {
      const c = dados.cobranca;
      Object.assign(row, {
        pagador_tipo: c.pagadorTipo,
        pagador_documento: c.pagadorDocumento,
        pagador_nome: c.pagadorNome,
        email: c.email || null,
        whatsapp: c.whatsapp || null,
        cep: c.cep || null,
        logradouro: c.logradouro || null,
        numero: c.numero || null,
        complemento: c.complemento || null,
        bairro: c.bairro || null,
        cidade: c.cidade || null,
        uf: c.uf || null,
      } satisfies Partial<EmpresaRow>);
    }
  }

  if (dados.regraPreco !== undefined) {
    if (dados.regraPreco === null) {
      Object.assign(row, {
        regra_preco_forma: null, regra_preco_base: null, regra_preco_limiar: null,
        regra_preco_taxa: null, regra_preco_valor_fixo: null,
      } satisfies Partial<EmpresaRow>);
    } else {
      const rp = dados.regraPreco;
      Object.assign(row, {
        regra_preco_forma: rp.forma,
        regra_preco_base: rp.base ?? null,
        regra_preco_limiar: rp.limiar ?? null,
        regra_preco_taxa: rp.taxa ?? null,
        regra_preco_valor_fixo: rp.valorFixo ?? null,
      } satisfies Partial<EmpresaRow>);
    }
  }

  if (dados.condicoes !== undefined) {
    if (dados.condicoes === null) {
      Object.assign(row, {
        dias_vencimento: null, multa_percent: null, juros_mes_percent: null,
        desconto_percent: null, desconto_dias: null,
      } satisfies Partial<EmpresaRow>);
    } else {
      const o = dados.condicoes;
      Object.assign(row, {
        dias_vencimento: o.diasVencimento,
        multa_percent: o.multaPercent,
        juros_mes_percent: o.jurosMesPercent,
        desconto_percent: o.descontoPercent,
        desconto_dias: o.descontoDias,
      } satisfies Partial<EmpresaRow>);
    }
  }

  return row;
}

export interface EmpresaHistoricoRow {
  id: string;
  empresa_id: string;
  campo_alterado: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  alterado_por: string;
  motivo: string | null;
  alterado_em: string;
}

export function toEmpresaHistorico(row: EmpresaHistoricoRow): EmpresaHistorico {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    campoAlterado: row.campo_alterado,
    valorAnterior: row.valor_anterior,
    valorNovo: row.valor_novo,
    alteradoPor: row.alterado_por,
    motivo: row.motivo,
    alteradoEm: row.alterado_em,
  };
}

// ---------------------------------------------------------------------------
// Cliente Contábil (Story 11.1, Epic 11) — mesmo padrão de empresa, reaproveitando os helpers de
// cobrança/condições/regra de preço acima. Domínio SEPARADO de `empresas` (Épico 10.4, agregação
// de produção médica) — ver docs/architecture/feature-emissao-contabilidade.md, decisão D1.
// ---------------------------------------------------------------------------

export interface ClienteContabilidadeRow extends CobrancaRowFields, CondicoesRowFields, RegraPrecoRowFields {
  id: string;
  nome: string;
  regime_tributario: ClienteContabilidade['regimeTributario'];
  modo_cobranca: ClienteContabilidade['modoCobranca'];
  conta_emissora: ClienteContabilidade['contaEmissora'];
  adicional_ativo: boolean;
  adicional_valor: number | null;
  adicional_intervalo_meses: number | null;
  adicional_competencia_base: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export function toClienteContabilidade(row: ClienteContabilidadeRow): ClienteContabilidade {
  return {
    id: row.id,
    nome: row.nome,
    regimeTributario: row.regime_tributario,
    modoCobranca: row.modo_cobranca,
    regraPreco: toRegraPreco(row),
    cobranca: toDadosCobranca(row),
    contaEmissora: row.conta_emissora,
    condicoes: toCondicoes(row),
    adicionalAtivo: row.adicional_ativo,
    adicionalValor: row.adicional_valor ?? null,
    adicionalIntervaloMeses: row.adicional_intervalo_meses ?? null,
    adicionalCompetenciaBase: row.adicional_competencia_base ?? null,
    ativo: row.ativo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Campos de domínio (camelCase) → colunas do banco (snake_case), só os presentes. */
export function clienteContabilidadeUpdateToRow(
  dados: Partial<ClienteContabilidade>,
): Partial<ClienteContabilidadeRow> {
  const map: Record<string, keyof ClienteContabilidadeRow> = {
    nome: 'nome',
    regimeTributario: 'regime_tributario',
    modoCobranca: 'modo_cobranca',
    contaEmissora: 'conta_emissora',
    adicionalAtivo: 'adicional_ativo',
    adicionalValor: 'adicional_valor',
    adicionalIntervaloMeses: 'adicional_intervalo_meses',
    adicionalCompetenciaBase: 'adicional_competencia_base',
    ativo: 'ativo',
  };
  const row: Partial<ClienteContabilidadeRow> = {};
  for (const [campo, valor] of Object.entries(dados)) {
    if (campo === 'cobranca' || campo === 'condicoes' || campo === 'regraPreco') continue;
    const col = map[campo];
    if (col) (row as Record<string, unknown>)[col] = valor === '' ? null : valor;
  }

  if (dados.cobranca !== undefined) {
    if (dados.cobranca === null) {
      Object.assign(row, {
        pagador_tipo: null, pagador_documento: null, pagador_nome: null, email: null,
        whatsapp: null, cep: null, logradouro: null, numero: null, complemento: null,
        bairro: null, cidade: null, uf: null,
      } satisfies Partial<ClienteContabilidadeRow>);
    } else {
      const c = dados.cobranca;
      Object.assign(row, {
        pagador_tipo: c.pagadorTipo,
        pagador_documento: c.pagadorDocumento,
        pagador_nome: c.pagadorNome,
        email: c.email || null,
        whatsapp: c.whatsapp || null,
        cep: c.cep || null,
        logradouro: c.logradouro || null,
        numero: c.numero || null,
        complemento: c.complemento || null,
        bairro: c.bairro || null,
        cidade: c.cidade || null,
        uf: c.uf || null,
      } satisfies Partial<ClienteContabilidadeRow>);
    }
  }

  if (dados.regraPreco !== undefined) {
    if (dados.regraPreco === null) {
      Object.assign(row, {
        regra_preco_forma: null, regra_preco_base: null, regra_preco_limiar: null,
        regra_preco_taxa: null, regra_preco_valor_fixo: null,
        regra_preco_valor_abaixo_limiar: null, regra_preco_valor_acima_limiar: null,
      } satisfies Partial<ClienteContabilidadeRow>);
    } else {
      const rp = dados.regraPreco;
      Object.assign(row, {
        regra_preco_forma: rp.forma,
        regra_preco_base: rp.base ?? null,
        regra_preco_limiar: rp.limiar ?? null,
        regra_preco_taxa: rp.taxa ?? null,
        regra_preco_valor_fixo: rp.valorFixo ?? null,
        regra_preco_valor_abaixo_limiar: rp.valorAbaixoLimiar ?? null,
        regra_preco_valor_acima_limiar: rp.valorAcimaLimiar ?? null,
      } satisfies Partial<ClienteContabilidadeRow>);
    }
  }

  if (dados.condicoes !== undefined) {
    if (dados.condicoes === null) {
      Object.assign(row, {
        dias_vencimento: null, multa_percent: null, juros_mes_percent: null,
        desconto_percent: null, desconto_dias: null,
      } satisfies Partial<ClienteContabilidadeRow>);
    } else {
      const o = dados.condicoes;
      Object.assign(row, {
        dias_vencimento: o.diasVencimento,
        multa_percent: o.multaPercent,
        juros_mes_percent: o.jurosMesPercent,
        desconto_percent: o.descontoPercent,
        desconto_dias: o.descontoDias,
      } satisfies Partial<ClienteContabilidadeRow>);
    }
  }

  return row;
}

export interface ClienteContabilidadeHistoricoRow {
  id: string;
  cliente_contabilidade_id: string;
  campo_alterado: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  alterado_por: string;
  motivo: string | null;
  alterado_em: string;
}

export function toClienteContabilidadeHistorico(
  row: ClienteContabilidadeHistoricoRow,
): ClienteContabilidadeHistorico {
  return {
    id: row.id,
    clienteContabilidadeId: row.cliente_contabilidade_id,
    campoAlterado: row.campo_alterado,
    valorAnterior: row.valor_anterior,
    valorNovo: row.valor_novo,
    alteradoPor: row.alterado_por,
    motivo: row.motivo,
    alteradoEm: row.alterado_em,
  };
}

export interface ClienteContabilidadeFaturamentoRow {
  id: string;
  cliente_contabilidade_id: string;
  competencia: string;
  faturamento: number;
  informado_por: string;
  informado_em: string;
}

export function toClienteContabilidadeFaturamento(
  row: ClienteContabilidadeFaturamentoRow,
): ClienteContabilidadeFaturamento {
  return {
    id: row.id,
    clienteContabilidadeId: row.cliente_contabilidade_id,
    competencia: row.competencia,
    faturamento: Number(row.faturamento), // numeric pode vir como string do PostgREST
    informadoPor: row.informado_por,
    informadoEm: row.informado_em,
  };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export interface ExecucaoRow {
  id: string;
  competencia: string;
  iniciado_por: string;
  iniciado_em: string;
  finalizado_em: string | null;
  status: Execucao['status'];
  progresso: number;
  total_medicos: number | null;
  total_ok: number | null;
  total_alerta: number | null;
  total_sem_dados: number | null;
  total_geral_valor: number | null;
  /** Execução agregada por empresa (migration 0029) — opcional em bancos sem a migration. */
  empresa_id?: string | null;
  /** Execução de cliente contábil (migration 0032, Story 11.3) — opcional em bancos sem a migration. */
  cliente_contabilidade_id?: string | null;
  /** Adicional semestral (migration 0033, Story 11.4) — opcional em bancos sem a migration. */
  eh_adicional?: boolean | null;
}

export function toExecucao(row: ExecucaoRow): Execucao {
  return {
    id: row.id,
    competencia: row.competencia,
    iniciadoPor: row.iniciado_por,
    iniciadoEm: row.iniciado_em,
    finalizadoEm: row.finalizado_em,
    status: row.status,
    progresso: row.progresso,
    totalMedicos: row.total_medicos,
    totalOk: row.total_ok,
    totalAlerta: row.total_alerta,
    totalSemDados: row.total_sem_dados,
    totalGeralValor: row.total_geral_valor,
    empresaId: row.empresa_id ?? null,
    clienteContabilidadeId: row.cliente_contabilidade_id ?? null,
    ehAdicional: row.eh_adicional ?? false,
  };
}

export interface ExecucaoSelecaoRow {
  execucao_id: string;
  medico_id: string;
  /** Null pra médico Angiologista (GATE 2026-08-07, migration 0044) — sem lote principal. */
  producao_externa_id: string | null;
  producao_nome: string | null;
  /** Produção de consultas de pediatria (migration 0026) — opcional em bancos sem a migration. */
  producao_consultas_externa_id?: string | null;
  producao_consultas_nome?: string | null;
  /** Lotes separados de Outros Hospitais/Imobilizações (Story 10.5, migration 0027). */
  producao_outros_hospitais_externa_id?: string | null;
  producao_outros_hospitais_nome?: string | null;
  producao_imobilizacoes_externa_id?: string | null;
  producao_imobilizacoes_nome?: string | null;
  /** Lotes de Cateter/Fístula/Angiografia do Angiologista (GATE 2026-08-07). Arrays desde a
   * migration 0046 (achado 2026-08-13): a origem divide cada categoria em quinzenas (1Q/2Q). */
  producao_cateter_externa_ids?: string[] | null;
  producao_cateter_nomes?: string[] | null;
  producao_fistula_externa_ids?: string[] | null;
  producao_fistula_nomes?: string[] | null;
  producao_angiografia_externa_ids?: string[] | null;
  producao_angiografia_nomes?: string[] | null;
  /** Carta de Rede do Angiologista (GATE 2026-08-12, migration 0045) — contagem MANUAL. */
  producao_carta_rede_externa_id?: string | null;
  producao_carta_rede_nome?: string | null;
  carta_rede_guias?: number | null;
  carta_rede_informado_por?: string | null;
  carta_rede_informado_em?: string | null;
}

export function toExecucaoSelecaoRow(selecao: {
  execucaoId: string;
  medicoId: string;
  producaoExternaId: string | null;
  producaoNome: string | null;
  producaoConsultasExternaId?: string | null;
  producaoConsultasNome?: string | null;
  producaoOutrosHospitaisExternaId?: string | null;
  producaoOutrosHospitaisNome?: string | null;
  producaoImobilizacoesExternaId?: string | null;
  producaoImobilizacoesNome?: string | null;
  producaoCateterExternaIds?: string[] | null;
  producaoCateterNomes?: string[] | null;
  producaoFistulaExternaIds?: string[] | null;
  producaoFistulaNomes?: string[] | null;
  producaoAngiografiaExternaIds?: string[] | null;
  producaoAngiografiaNomes?: string[] | null;
  producaoCartaRedeExternaId?: string | null;
  producaoCartaRedeNome?: string | null;
  cartaRedeGuias?: number | null;
  cartaRedeInformadoPor?: string | null;
  cartaRedeInformadoEm?: string | null;
}): ExecucaoSelecaoRow {
  return {
    execucao_id: selecao.execucaoId,
    medico_id: selecao.medicoId,
    producao_externa_id: selecao.producaoExternaId,
    producao_nome: selecao.producaoNome,
    producao_consultas_externa_id: selecao.producaoConsultasExternaId ?? null,
    producao_consultas_nome: selecao.producaoConsultasNome ?? null,
    producao_outros_hospitais_externa_id: selecao.producaoOutrosHospitaisExternaId ?? null,
    producao_outros_hospitais_nome: selecao.producaoOutrosHospitaisNome ?? null,
    producao_imobilizacoes_externa_id: selecao.producaoImobilizacoesExternaId ?? null,
    producao_imobilizacoes_nome: selecao.producaoImobilizacoesNome ?? null,
    producao_cateter_externa_ids: selecao.producaoCateterExternaIds ?? null,
    producao_cateter_nomes: selecao.producaoCateterNomes ?? null,
    producao_fistula_externa_ids: selecao.producaoFistulaExternaIds ?? null,
    producao_fistula_nomes: selecao.producaoFistulaNomes ?? null,
    producao_angiografia_externa_ids: selecao.producaoAngiografiaExternaIds ?? null,
    producao_angiografia_nomes: selecao.producaoAngiografiaNomes ?? null,
    producao_carta_rede_externa_id: selecao.producaoCartaRedeExternaId ?? null,
    producao_carta_rede_nome: selecao.producaoCartaRedeNome ?? null,
    carta_rede_guias: selecao.cartaRedeGuias ?? null,
    carta_rede_informado_por: selecao.cartaRedeInformadoPor ?? null,
    carta_rede_informado_em: selecao.cartaRedeInformadoEm ?? null,
  };
}

export function toExecucaoSelecao(row: ExecucaoSelecaoRow) {
  return {
    execucaoId: row.execucao_id,
    medicoId: row.medico_id,
    producaoExternaId: row.producao_externa_id,
    producaoNome: row.producao_nome,
    producaoConsultasExternaId: row.producao_consultas_externa_id ?? null,
    producaoConsultasNome: row.producao_consultas_nome ?? null,
    producaoOutrosHospitaisExternaId: row.producao_outros_hospitais_externa_id ?? null,
    producaoOutrosHospitaisNome: row.producao_outros_hospitais_nome ?? null,
    producaoImobilizacoesExternaId: row.producao_imobilizacoes_externa_id ?? null,
    producaoImobilizacoesNome: row.producao_imobilizacoes_nome ?? null,
    producaoCateterExternaIds: row.producao_cateter_externa_ids ?? null,
    producaoCateterNomes: row.producao_cateter_nomes ?? null,
    producaoFistulaExternaIds: row.producao_fistula_externa_ids ?? null,
    producaoFistulaNomes: row.producao_fistula_nomes ?? null,
    producaoAngiografiaExternaIds: row.producao_angiografia_externa_ids ?? null,
    producaoAngiografiaNomes: row.producao_angiografia_nomes ?? null,
    producaoCartaRedeExternaId: row.producao_carta_rede_externa_id ?? null,
    producaoCartaRedeNome: row.producao_carta_rede_nome ?? null,
    cartaRedeGuias: row.carta_rede_guias ?? null,
    cartaRedeInformadoPor: row.carta_rede_informado_por ?? null,
    cartaRedeInformadoEm: row.carta_rede_informado_em ?? null,
  };
}

export interface ExecucaoResultadoRow {
  id: string;
  execucao_id: string;
  medico_id: string | null;
  cpf: string;
  nome: string;
  procedimentos: number | null;
  cirurgias: number | null;
  guias: number | null;
  guias_consolidado: number | null;
  subtotais: Subtotal[] | null;
  total_valor: number | null;
  status: ExecucaoResultado['status'];
  alertas: string[] | null;
  status_original: ExecucaoResultado['status'] | null;
  revisado_por: string | null;
  revisado_em: string | null;
  motivo_revisao: string | null;
  /** Resultado agregado por empresa (migration 0029) — opcional em bancos sem a migration. */
  empresa_id?: string | null;
  /** Resultado de cliente contábil (migration 0032, Story 11.3) — opcional em bancos sem a migration. */
  cliente_contabilidade_id?: string | null;
  /** Auditoria do último recálculo manual (migration 0041) — opcional em bancos sem a migration. */
  recalculado_por?: string | null;
  recalculado_em?: string | null;
}

export function toExecucaoResultado(row: ExecucaoResultadoRow): ExecucaoResultado {
  return {
    id: row.id,
    execucaoId: row.execucao_id,
    medicoId: row.medico_id,
    cpf: row.cpf,
    nome: row.nome,
    procedimentos: row.procedimentos,
    cirurgias: row.cirurgias,
    guias: row.guias,
    guiasConsolidado: row.guias_consolidado,
    subtotais: row.subtotais,
    totalValor: row.total_valor,
    status: row.status,
    alertas: row.alertas ?? [],
    statusOriginal: row.status_original ?? null,
    revisadoPor: row.revisado_por ?? null,
    revisadoEm: row.revisado_em ?? null,
    motivoRevisao: row.motivo_revisao ?? null,
    empresaId: row.empresa_id ?? null,
    clienteContabilidadeId: row.cliente_contabilidade_id ?? null,
    recalculadoPor: row.recalculado_por ?? null,
    recalculadoEm: row.recalculado_em ?? null,
  };
}

export interface ExecucaoResultadoContribuicaoRow {
  id: string;
  execucao_resultado_id: string;
  medico_id: string;
  guias: number;
  valor: number;
  criado_em: string;
}

export function toExecucaoResultadoContribuicao(
  row: ExecucaoResultadoContribuicaoRow,
): ExecucaoResultadoContribuicao {
  return {
    id: row.id,
    execucaoResultadoId: row.execucao_resultado_id,
    medicoId: row.medico_id,
    guias: row.guias,
    valor: row.valor,
    criadoEm: row.criado_em,
  };
}

export interface ExecucaoResumoMedicoRow {
  medico_id: string | null;
  cpf: string;
  nome: string;
  ultima_competencia: string;
  ultima_execucao_id: string;
  ultima_execucao_status: Execucao['status'];
  ultimo_status_resultado: ExecucaoResultado['status'];
  ultimo_valor: number | null;
  qtd_execucoes: number;
}

export function toExecucaoResumoMedico(row: ExecucaoResumoMedicoRow): ExecucaoResumoMedico {
  return {
    medicoId: row.medico_id,
    cpf: row.cpf,
    nome: row.nome,
    ultimaCompetencia: row.ultima_competencia,
    ultimaExecucaoId: row.ultima_execucao_id,
    ultimaExecucaoStatus: row.ultima_execucao_status,
    ultimoStatusResultado: row.ultimo_status_resultado,
    ultimoValor: row.ultimo_valor,
    qtdExecucoes: row.qtd_execucoes,
  };
}

export interface ExecucaoHistoricoMedicoItemRow {
  execucao_id: string;
  status: ExecucaoResultado['status'];
  total_valor: number | null;
  execucoes: {
    competencia: string;
    status: Execucao['status'];
    iniciado_em: string;
    /** Adicional semestral (migration 0033, Story 11.4) — opcional em bancos sem a migration. */
    eh_adicional?: boolean | null;
  };
}

export function toExecucaoHistoricoMedicoItem(
  row: ExecucaoHistoricoMedicoItemRow,
): ExecucaoHistoricoMedicoItem {
  return {
    execucaoId: row.execucao_id,
    competencia: row.execucoes.competencia,
    execucaoStatus: row.execucoes.status,
    statusResultado: row.status,
    totalValor: row.total_valor,
    iniciadoEm: row.execucoes.iniciado_em,
    ehAdicional: row.execucoes.eh_adicional ?? false,
  };
}

// ---------------------------------------------------------------------------
// Boleto
// ---------------------------------------------------------------------------

export interface BoletoRow {
  id: string;
  execucao_resultado_id: string;
  gateway: Boleto['gateway'];
  /** Conta emissora (migration 0021) — opcional em bancos sem a migration aplicada. */
  conta_emissora?: Boleto['contaEmissora'] | null;
  id_externo: string | null;
  status: Boleto['status'];
  emitido_por: string;
  emitido_em: string;
  payload_resposta: unknown;
  // Baixa / conciliação (Épico 4)
  vencimento: string | null;
  pago_em: string | null;
  valor_pago: number | null;
  atualizado_em: string | null;
  // Cancelamento ativo (Story 6.1)
  cancelado_em: string | null;
  cancelado_por: string | null;
  motivo_cancelamento: string | null;
  /** Lote de emissão (migration 0038) — opcional em bancos sem a migration. */
  lote_id?: string | null;
}

export function toBoleto(row: BoletoRow): Boleto {
  return {
    id: row.id,
    execucaoResultadoId: row.execucao_resultado_id,
    gateway: row.gateway,
    contaEmissora: row.conta_emissora ?? 'mc', // default seguro pré-migration 0021 (backfill)
    idExterno: row.id_externo,
    status: row.status,
    emitidoPor: row.emitido_por,
    emitidoEm: row.emitido_em,
    payloadResposta: row.payload_resposta,
    vencimento: row.vencimento ?? null,
    pagoEm: row.pago_em ?? null,
    valorPago: row.valor_pago ?? null,
    canceladoEm: row.cancelado_em ?? null,
    canceladoPor: row.cancelado_por ?? null,
    motivoCancelamento: row.motivo_cancelamento ?? null,
    loteId: row.lote_id ?? null,
  };
}

export interface BoletoEventoRow {
  id: string;
  boleto_id: string | null;
  id_externo: string | null;
  evento_id: string | null;
  evento_tipo: string | null;
  status_reconsultado: string | null;
  payload: unknown;
  recebido_em: string;
}

export function toBoletoEvento(row: BoletoEventoRow): BoletoEvento {
  return {
    id: row.id,
    boletoId: row.boleto_id,
    idExterno: row.id_externo,
    eventoId: row.evento_id,
    eventoTipo: row.evento_tipo,
    statusReconsultado: row.status_reconsultado,
    payload: row.payload,
    recebidoEm: row.recebido_em,
  };
}

export interface RecebivelRow {
  boleto_id: string;
  execucao_resultado_id: string;
  id_externo: string | null;
  competencia: string;
  medico_id: string | null;
  nome: string;
  valor: number | null;
  vencimento: string | null;
  pago_em: string | null;
  valor_pago: number | null;
  emitido_em: string;
  /** Conta emissora (migration 0021) — opcional em bancos sem a migration aplicada. */
  conta_emissora?: Recebivel['contaEmissora'] | null;
  status_derivado: StatusRecebivel;
}

export function toRecebivel(row: RecebivelRow): Recebivel {
  return {
    boletoId: row.boleto_id,
    execucaoResultadoId: row.execucao_resultado_id,
    idExterno: row.id_externo,
    competencia: row.competencia,
    medicoId: row.medico_id,
    nome: row.nome,
    valor: row.valor,
    vencimento: row.vencimento,
    pagoEm: row.pago_em,
    valorPago: row.valor_pago,
    emitidoEm: row.emitido_em,
    contaEmissora: row.conta_emissora ?? 'mc', // default seguro pré-migration 0021 (backfill)
    statusDerivado: row.status_derivado,
  };
}

// ---------------------------------------------------------------------------
// Dashboard (agregações — views vw_dashboard_*)
// ---------------------------------------------------------------------------
const num = (v: number | null | undefined): number => Number(v ?? 0);

export interface ResumoCompetenciaRow {
  competencia: string | null;
  qtd_boletos: number | null;
  total_emitido: number | null;
  total_recebido: number | null;
  total_em_aberto: number | null;
  total_vencido: number | null;
  taxa_inadimplencia: number | null;
}

export function toResumoCompetencia(row: ResumoCompetenciaRow): ResumoCompetencia {
  return {
    competencia: row.competencia,
    qtdBoletos: num(row.qtd_boletos),
    totalEmitido: num(row.total_emitido),
    totalRecebido: num(row.total_recebido),
    totalEmAberto: num(row.total_em_aberto),
    totalVencido: num(row.total_vencido),
    taxaInadimplencia: num(row.taxa_inadimplencia),
  };
}

export interface ResumoMedicoRow extends Omit<ResumoCompetenciaRow, 'competencia'> {
  medico_id: string | null;
  nome: string;
  ticket_medio: number | null;
}

export function toResumoMedico(row: ResumoMedicoRow): ResumoMedico {
  return {
    medicoId: row.medico_id,
    nome: row.nome,
    qtdBoletos: num(row.qtd_boletos),
    totalEmitido: num(row.total_emitido),
    totalRecebido: num(row.total_recebido),
    totalEmAberto: num(row.total_em_aberto),
    totalVencido: num(row.total_vencido),
    taxaInadimplencia: num(row.taxa_inadimplencia),
    ticketMedio: num(row.ticket_medio),
  };
}

export interface ResumoPorEmpresaRow extends Omit<ResumoCompetenciaRow, 'competencia'> {
  conta_emissora: ResumoPorEmpresa['contaEmissora'];
  competencia: string | null;
}

export function toResumoPorEmpresa(row: ResumoPorEmpresaRow): ResumoPorEmpresa {
  return {
    contaEmissora: row.conta_emissora,
    competencia: row.competencia,
    qtdBoletos: num(row.qtd_boletos),
    totalEmitido: num(row.total_emitido),
    totalRecebido: num(row.total_recebido),
    totalEmAberto: num(row.total_em_aberto),
    totalVencido: num(row.total_vencido),
    taxaInadimplencia: num(row.taxa_inadimplencia),
  };
}

export interface AgingFaixaRow {
  faixa: string;
  qtd: number | null;
  total: number | null;
}

export function toAgingFaixa(row: AgingFaixaRow): AgingFaixa {
  return { faixa: row.faixa, qtd: num(row.qtd), total: num(row.total) };
}

// ---------------------------------------------------------------------------
// Extrato bancário (Épico 8)
// ---------------------------------------------------------------------------

export interface ExtratoTransacaoRow {
  id: string;
  conta_emissora: ExtratoTransacao['contaEmissora'];
  entry_id: string;
  tipo: ExtratoTransacao['tipo'];
  transaction_type: string | null;
  valor: number;
  descricao: string | null;
  contraparte_nome: string | null;
  contraparte_documento: string | null;
  data_transacao: string;
  status_conciliacao: ExtratoTransacao['statusConciliacao'];
  boleto_id: string | null;
  conciliado_por: string | null;
  conciliado_em: string | null;
  payload: unknown;
  sincronizado_em: string;
  categoria_id: string | null;
  status_categorizacao: ExtratoTransacao['statusCategorizacao'];
}

export function toExtratoTransacao(row: ExtratoTransacaoRow): ExtratoTransacao {
  return {
    id: row.id,
    contaEmissora: row.conta_emissora,
    entryId: row.entry_id,
    tipo: row.tipo,
    transactionType: row.transaction_type,
    valor: Number(row.valor), // numeric pode vir como string do PostgREST
    descricao: row.descricao,
    contraparteNome: row.contraparte_nome,
    contraparteDocumento: row.contraparte_documento,
    dataTransacao: row.data_transacao,
    statusConciliacao: row.status_conciliacao,
    boletoId: row.boleto_id,
    conciliadoPor: row.conciliado_por,
    conciliadoEm: row.conciliado_em,
    payload: row.payload,
    sincronizadoEm: row.sincronizado_em,
    categoriaId: row.categoria_id,
    statusCategorizacao: row.status_categorizacao,
  };
}

// ---------------------------------------------------------------------------
// DRE / Plano de contas (Épico 9)
// ---------------------------------------------------------------------------

export interface PlanoContasRow {
  id: string;
  grupo: PlanoContas['grupo'];
  nome: string;
  sistema: boolean;
  ativo: boolean;
  ordem: number;
  criado_em: string;
}

export function toPlanoContas(row: PlanoContasRow): PlanoContas {
  return {
    id: row.id,
    grupo: row.grupo,
    nome: row.nome,
    sistema: row.sistema,
    ativo: row.ativo,
    ordem: row.ordem,
    criadoEm: row.criado_em,
  };
}

export interface RegraCategorizacaoRow {
  id: string;
  categoria_id: string;
  campo: RegraCategorizacao['campo'];
  padrao: string;
  prioridade: number;
  ativo: boolean;
  criado_em: string;
}

export function toRegraCategorizacao(row: RegraCategorizacaoRow): RegraCategorizacao {
  return {
    id: row.id,
    categoriaId: row.categoria_id,
    campo: row.campo,
    padrao: row.padrao,
    prioridade: row.prioridade,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  };
}

export interface LancamentoManualRow {
  id: string;
  conta_emissora: LancamentoManual['contaEmissora'];
  categoria_id: string;
  descricao: string;
  valor: number;
  tipo_lancamento: LancamentoManual['tipoLancamento'];
  data: string | null;
  dia_do_mes: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  criado_por: string;
  criado_em: string;
}

export function toLancamentoManual(row: LancamentoManualRow): LancamentoManual {
  return {
    id: row.id,
    contaEmissora: row.conta_emissora,
    categoriaId: row.categoria_id,
    descricao: row.descricao,
    valor: Number(row.valor),
    tipoLancamento: row.tipo_lancamento,
    data: row.data,
    diaDoMes: row.dia_do_mes,
    dataInicio: row.data_inicio,
    dataFim: row.data_fim,
    criadoPor: row.criado_por,
    criadoEm: row.criado_em,
  };
}

// ---------------------------------------------------------------------------
// Lote de emissão (migration 0038)
// ---------------------------------------------------------------------------

export interface LoteEmissaoRow {
  id: string;
  escopo_tipo: LoteEmissao['escopoTipo'];
  escopo_ref: string;
  status: LoteEmissao['status'];
  criado_por: string;
  criado_em: string;
  confirmado_por: string | null;
  confirmado_em: string | null;
  finalizado_em: string | null;
  snapshot_total_itens: number;
  snapshot_total_valor: number;
  progresso: number;
  falhas_consecutivas: number;
  motivo_pausa: string | null;
  total_emitidos: number;
  total_pulados: number;
  total_falhas: number;
  total_valor_emitido: number;
}

export function toLoteEmissao(row: LoteEmissaoRow): LoteEmissao {
  return {
    id: row.id,
    escopoTipo: row.escopo_tipo,
    escopoRef: row.escopo_ref,
    status: row.status,
    criadoPor: row.criado_por,
    criadoEm: row.criado_em,
    confirmadoPor: row.confirmado_por,
    confirmadoEm: row.confirmado_em,
    finalizadoEm: row.finalizado_em,
    snapshotTotalItens: row.snapshot_total_itens,
    snapshotTotalValor: Number(row.snapshot_total_valor),
    progresso: row.progresso,
    falhasConsecutivas: row.falhas_consecutivas,
    motivoPausa: row.motivo_pausa,
    totalEmitidos: row.total_emitidos,
    totalPulados: row.total_pulados,
    totalFalhas: row.total_falhas,
    totalValorEmitido: Number(row.total_valor_emitido),
  };
}

export interface LoteEmissaoItemRow {
  id: string;
  lote_id: string;
  execucao_resultado_id: string;
  conta_emissora: LoteEmissaoItem['contaEmissora'];
  valor_snapshot: number;
  status: LoteEmissaoItem['status'];
  codigo_erro: string | null;
  mensagem_erro: string | null;
  boleto_id: string | null;
  processado_em: string | null;
}

export function toLoteEmissaoItem(row: LoteEmissaoItemRow): LoteEmissaoItem {
  return {
    id: row.id,
    loteId: row.lote_id,
    execucaoResultadoId: row.execucao_resultado_id,
    contaEmissora: row.conta_emissora,
    valorSnapshot: Number(row.valor_snapshot),
    status: row.status,
    codigoErro: row.codigo_erro,
    mensagemErro: row.mensagem_erro,
    boletoId: row.boleto_id,
    processadoEm: row.processado_em,
  };
}

// ---------------------------------------------------------------------------
// Relatórios — link público do BI (migration 0047)
// ---------------------------------------------------------------------------

export interface RelatorioLinkRow {
  id: string;
  token: string;
  nome: string;
  escopo_conta_emissora: RelatorioLink['escopoContaEmissora'];
  criado_por: string;
  criado_em: string;
  expira_em: string | null;
  revogado_em: string | null;
  ultimo_acesso_em: string | null;
}

export function toRelatorioLink(row: RelatorioLinkRow): RelatorioLink {
  return {
    id: row.id,
    token: row.token,
    nome: row.nome,
    escopoContaEmissora: row.escopo_conta_emissora,
    criadoPor: row.criado_por,
    criadoEm: row.criado_em,
    expiraEm: row.expira_em,
    revogadoEm: row.revogado_em,
    ultimoAcessoEm: row.ultimo_acesso_em,
  };
}
