// Schemas Zod de validação de input das rotas de médico (architecture: Input Validation).
import { z } from 'zod';
import { CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';

export const statusHapvidaSchema = z.enum(['credenciado', 'nao_credenciado', 'nenhum']);
export const modoMudancaDataSchema = z.enum(['sim', 'nao']);
export const modoCobrancaSchema = z.enum(['faixa_guias', 'percentual_producao', 'preco_proprio']);
// Regra de preço própria (Story 10.1) — GATE do dono 2026-07-20. Nefrologia/guias cardíacas
// saíram para a Story 10.4 (agrupamento por empresa). Ezequiel (por_guia, R$4,00) reincluído
// no automático em 2026-07-20 — confirmado estável, deixou de ser caso manual.
// 'faixa_faturamento' (Story 11.1, Epic 11) — clientes de contabilidade no Simples Nacional.
export const regraPrecoFormaSchema = z.enum(['por_guia', 'base_excedente', 'fixo', 'faixa_faturamento']);
// Conta emissora (Story 7.1, QA-711-2) — espelha a CHECK da migration 0021.
export const contaEmissoraSchema = z.enum(CONTAS_EMISSORAS_VALIDAS);
export const pagadorTipoSchema = z.enum(['PF', 'PJ']);

/**
 * Espelho da CHECK do banco (0018): modo percentual exige percentual > 0.
 * Usado nos schemas de criação e atualização (Story 6.2).
 */
function percentualCoerente(d: { modoCobranca?: ModoCobrancaInput; percentualProducao?: number | null }): boolean {
  if (d.modoCobranca !== 'percentual_producao') return true;
  return d.percentualProducao != null && d.percentualProducao > 0;
}
type ModoCobrancaInput = z.infer<typeof modoCobrancaSchema>;
const MSG_PERCENTUAL = 'Modo percentual exige percentual de produção maior que zero';

/**
 * Regra de preço própria (Story 10.1). Coerência interna por forma já é validada pelo
 * `.refine` do próprio `regraPrecoSchema`; esta função só checa que o modo 'preco_proprio'
 * veio acompanhado de alguma regra (espelho da CHECK `chk_medicos_regra_preco_coerente`).
 */
export const regraPrecoSchema = z
  .object({
    forma: regraPrecoFormaSchema,
    base: z.number().min(0).nullable().optional().default(null),
    // 'limiar' é reaproveitado como corte de guias (base_excedente) OU corte de faturamento em
    // R$ (faixa_faturamento, Story 11.1) — por isso não é .int() (faturamento tem centavos).
    limiar: z.number().min(0).nullable().optional().default(null),
    taxa: z.number().min(0).nullable().optional().default(null),
    valorFixo: z.number().min(0).nullable().optional().default(null),
    valorAbaixoLimiar: z.number().min(0).nullable().optional().default(null),
    valorAcimaLimiar: z.number().min(0).nullable().optional().default(null),
  })
  .refine((r) => r.forma !== 'por_guia' || r.taxa != null, {
    message: 'Forma "por guia" exige taxa',
    path: ['taxa'],
  })
  .refine((r) => r.forma !== 'base_excedente' || (r.base != null && r.limiar != null && r.taxa != null), {
    message: 'Forma "base + excedente" exige base, limiar e taxa',
    path: ['forma'],
  })
  // limiar de guias precisa ser inteiro (coluna integer em medicos/empresas); faixa_faturamento
  // usa o mesmo campo para um corte em R$ (coluna numeric em clientes_contabilidade), que aceita
  // centavos — por isso o .int() é condicional à forma, não no tipo base do campo.
  .refine((r) => r.forma !== 'base_excedente' || r.limiar == null || Number.isInteger(r.limiar), {
    message: 'Forma "base + excedente" exige limiar inteiro (quantidade de guias)',
    path: ['limiar'],
  })
  .refine((r) => r.forma !== 'fixo' || r.valorFixo != null, {
    message: 'Forma "fixo" exige valor fixo',
    path: ['valorFixo'],
  })
  .refine(
    (r) =>
      r.forma !== 'faixa_faturamento' ||
      (r.limiar != null && r.valorAbaixoLimiar != null && r.valorAcimaLimiar != null),
    {
      message: 'Forma "faixa de faturamento" exige limiar, valor abaixo e valor acima do limiar',
      path: ['forma'],
    },
  );
type RegraPrecoInput = z.infer<typeof regraPrecoSchema>;

function regraPrecoCoerente(d: { modoCobranca?: ModoCobrancaInput; regraPreco?: RegraPrecoInput | null }): boolean {
  if (d.modoCobranca !== 'preco_proprio') return true;
  return d.regraPreco != null;
}
const MSG_REGRA_PRECO = 'Modo preço próprio exige a regra de preço (forma + parâmetros)';

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
] as const;
export const ufSchema = z.enum(UFS);

/**
 * Bloco de cobrança do pagador. Documento validado por tipo (CPF=11, CNPJ=14 dígitos).
 * Mínimo pra emitir (Épico 6): pagadorTipo + pagadorDocumento + pagadorNome. E-mail,
 * WhatsApp, endereço e complemento são opcionais (vazio/ausente é válido) — mas se
 * preenchidos, seguem validados no formato (e-mail válido, CEP 8 dígitos, UF real).
 */
export const dadosCobrancaSchema = z
  .object({
    pagadorTipo: pagadorTipoSchema,
    pagadorDocumento: z.string().regex(/^\d+$/, 'Documento deve conter apenas dígitos'),
    pagadorNome: z.string().min(1, 'Nome/razão social é obrigatório'),
    email: z.string().email('E-mail inválido').or(z.literal('')).default(''),
    whatsapp: z.string().nullable().optional().default(null),
    cep: z.string().regex(/^\d{8}$/, 'CEP deve ter 8 dígitos sem pontuação').or(z.literal('')).default(''),
    logradouro: z.string().default(''),
    numero: z.string().default(''),
    complemento: z.string().nullable().default(null),
    bairro: z.string().default(''),
    cidade: z.string().default(''),
    uf: ufSchema.or(z.literal('')).default(''),
  })
  .refine(
    (c) => (c.pagadorTipo === 'PF' ? c.pagadorDocumento.length === 11 : c.pagadorDocumento.length === 14),
    { message: 'Documento incompatível com o tipo (PF=11 dígitos, PJ=14 dígitos)', path: ['pagadorDocumento'] },
  );

/** Overrides comerciais opcionais por médico (percentuais 0–100, dias 0–365). */
export const condicoesCobrancaSchema = z.object({
  diasVencimento: z.number().int().min(0).max(365).nullable().default(null),
  multaPercent: z.number().min(0).max(100).nullable().default(null),
  jurosMesPercent: z.number().min(0).max(100).nullable().default(null),
  descontoPercent: z.number().min(0).max(100).nullable().default(null),
  descontoDias: z.number().int().min(0).max(365).nullable().default(null),
});

/** Defaults globais do escritório (config_cobranca). diasVencimento é obrigatório. */
export const configCobrancaSchema = z.object({
  diasVencimento: z.number().int().min(0).max(365),
  multaPercent: z.number().min(0).max(100).nullable(),
  jurosMesPercent: z.number().min(0).max(100).nullable(),
  descontoPercent: z.number().min(0).max(100).nullable(),
  descontoDias: z.number().int().min(0).max(365).nullable(),
  // Valor unitário da consulta ambulatorial de pediatria (Story 10.2) — global, > 0.
  valorConsultaPediatria: z.number().min(0.01),
});

export const novoMedicoSchema = z
  .object({
    cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos sem pontuação').or(z.literal('')),
    nome: z.string().min(1, 'Nome é obrigatório'),
    especialidade: z.string().nullable().optional().default(null),
    statusHapvida: statusHapvidaSchema,
    fazOutrosHospitais: z.boolean().default(false),
    fazImobilizacoes: z.boolean().default(false),
    modoMudancaData: modoMudancaDataSchema.default('nao'),
    // Modo de cobrança (Story 6.2) — percentual 0.01–100 com 2 casas (numeric(5,2) no banco).
    modoCobranca: modoCobrancaSchema.default('faixa_guias'),
    percentualProducao: z.number().min(0.01).max(100).nullable().optional().default(null),
    // Regra de preço própria (Story 10.1) — obrigatória quando modoCobranca = 'preco_proprio'.
    regraPreco: regraPrecoSchema.nullable().optional().default(null),
    // Opcional SEM default: ausente → default 'mc' do banco (insert sem a coluna funciona
    // inclusive pré-migration 0021, mesmo padrão do criarBoleto).
    contaEmissora: contaEmissoraSchema.optional(),
    colaboradorResponsavel: z.string().nullable().optional().default(null),
    ativo: z.boolean().default(true),
    // Bloco de cobrança é opcional — médico pode ser salvo e completado depois.
    cobranca: dadosCobrancaSchema.nullable().optional(),
    condicoes: condicoesCobrancaSchema.nullable().optional(),
    // Vínculo com empresa de agrupamento (Story 10.4a) — opcional, null = sem vínculo.
    empresaGrupoId: z.string().uuid().nullable().optional().default(null),
    // Contrato sem excedente por guia (Story 10.7) — capa na última faixa em vez de somar
    // excedente por guia acima do teto; tabela/faixas continuam as mesmas (não confundir com
    // regraPreco/preco_proprio, que substitui a tabela inteira).
    semExcedentePorGuia: z.boolean().default(false),
  })
  .refine(percentualCoerente, { message: MSG_PERCENTUAL, path: ['percentualProducao'] })
  .refine(regraPrecoCoerente, { message: MSG_REGRA_PRECO, path: ['regraPreco'] });

export const atualizarMedicoSchema = z
  .object({
    cpf: z.string().regex(/^\d{11}$/).or(z.literal('')).optional(),
    nome: z.string().min(1).optional(),
    especialidade: z.string().nullable().optional(),
    statusHapvida: statusHapvidaSchema.optional(),
    fazOutrosHospitais: z.boolean().optional(),
    fazImobilizacoes: z.boolean().optional(),
    modoMudancaData: modoMudancaDataSchema.optional(),
    modoCobranca: modoCobrancaSchema.optional(),
    percentualProducao: z.number().min(0.01).max(100).nullable().optional(),
    regraPreco: regraPrecoSchema.nullable().optional(),
    contaEmissora: contaEmissoraSchema.optional(),
    colaboradorResponsavel: z.string().nullable().optional(),
    ativo: z.boolean().optional(),
    necessitaConfiguracao: z.boolean().optional(),
    cobranca: dadosCobrancaSchema.nullable().optional(),
    condicoes: condicoesCobrancaSchema.nullable().optional(),
    empresaGrupoId: z.string().uuid().nullable().optional(),
    semExcedentePorGuia: z.boolean().optional(),
    motivo: z.string().min(1, 'Motivo é obrigatório para alterar um médico'),
  })
  .strict()
  // Ao MUDAR para percentual/preço próprio, o campo correspondente deve vir junto (a CHECK do
  // banco é a defesa final para o caso de update parcial sobre médico já nesse modo).
  .refine(percentualCoerente, { message: MSG_PERCENTUAL, path: ['percentualProducao'] })
  .refine(regraPrecoCoerente, { message: MSG_REGRA_PRECO, path: ['regraPreco'] });

// Sincronização com a origem (Épico 5) — vínculo confirmado pelo usuário.
// externalId NÃO é UUID: a API real da Carmem usa IDs numéricos serializados
// como string (ex.: "313") — contrato real ≠ presumido (Épico 5).
export const vincularMedicoSchema = z
  .object({
    externalId: z.string().min(1, 'externalId é obrigatório'),
    medicoId: z.string().uuid('medicoId deve ser um UUID'),
  })
  .strict();

export const criarMedicoExternoSchema = z
  .object({
    externalId: z.string().min(1, 'externalId é obrigatório'),
  })
  .strict();

export const criarMedicosExternosSchema = z
  .object({
    externalIds: z.array(z.string().min(1)).min(1, 'Informe pelo menos um externalId'),
  })
  .strict();

export const excluirMedicosSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, 'Informe pelo menos um médico'),
  })
  .strict();

export type NovoMedicoInput = z.infer<typeof novoMedicoSchema>;
export type AtualizarMedicoInput = z.infer<typeof atualizarMedicoSchema>;
