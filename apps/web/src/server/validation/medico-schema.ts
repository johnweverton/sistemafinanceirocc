// Schemas Zod de validação de input das rotas de médico (architecture: Input Validation).
import { z } from 'zod';

export const statusHapvidaSchema = z.enum(['credenciado', 'nao_credenciado', 'nenhum']);
export const modoMudancaDataSchema = z.enum(['sim', 'nao']);
export const pagadorTipoSchema = z.enum(['PF', 'PJ']);

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
] as const;
export const ufSchema = z.enum(UFS);

/**
 * Bloco de cobrança do pagador. Documento validado por tipo (CPF=11, CNPJ=14 dígitos).
 * Complemento é o único campo opcional.
 */
export const dadosCobrancaSchema = z
  .object({
    pagadorTipo: pagadorTipoSchema,
    pagadorDocumento: z.string().regex(/^\d+$/, 'Documento deve conter apenas dígitos'),
    pagadorNome: z.string().min(1, 'Nome/razão social é obrigatório'),
    email: z.string().email('E-mail inválido'),
    cep: z.string().regex(/^\d{8}$/, 'CEP deve ter 8 dígitos sem pontuação'),
    logradouro: z.string().min(1, 'Logradouro é obrigatório'),
    numero: z.string().min(1, 'Número é obrigatório'),
    complemento: z.string().nullable().optional().default(null),
    bairro: z.string().min(1, 'Bairro é obrigatório'),
    cidade: z.string().min(1, 'Cidade é obrigatória'),
    uf: ufSchema,
  })
  .refine(
    (c) => (c.pagadorTipo === 'PF' ? c.pagadorDocumento.length === 11 : c.pagadorDocumento.length === 14),
    { message: 'Documento incompatível com o tipo (PF=11 dígitos, PJ=14 dígitos)', path: ['pagadorDocumento'] },
  );

/** Overrides comerciais opcionais por médico (percentuais 0–100, dias 0–365). */
export const condicoesCobrancaSchema = z.object({
  diasVencimento: z.number().int().min(0).max(365).nullable().optional(),
  multaPercent: z.number().min(0).max(100).nullable().optional(),
  jurosMesPercent: z.number().min(0).max(100).nullable().optional(),
  descontoPercent: z.number().min(0).max(100).nullable().optional(),
  descontoDias: z.number().int().min(0).max(365).nullable().optional(),
});

export const novoMedicoSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos sem pontuação'),
  nome: z.string().min(1, 'Nome é obrigatório'),
  especialidade: z.string().nullable().optional().default(null),
  statusHapvida: statusHapvidaSchema,
  fazOutrosHospitais: z.boolean().default(false),
  fazImobilizacoes: z.boolean().default(false),
  modoMudancaData: modoMudancaDataSchema.default('nao'),
  colaboradorResponsavel: z.string().nullable().optional().default(null),
  ativo: z.boolean().default(true),
  // Bloco de cobrança é opcional — médico pode ser salvo e completado depois.
  cobranca: dadosCobrancaSchema.nullable().optional(),
  condicoes: condicoesCobrancaSchema.nullable().optional(),
});

export const atualizarMedicoSchema = z
  .object({
    cpf: z.string().regex(/^\d{11}$/).optional(),
    nome: z.string().min(1).optional(),
    especialidade: z.string().nullable().optional(),
    statusHapvida: statusHapvidaSchema.optional(),
    fazOutrosHospitais: z.boolean().optional(),
    fazImobilizacoes: z.boolean().optional(),
    modoMudancaData: modoMudancaDataSchema.optional(),
    colaboradorResponsavel: z.string().nullable().optional(),
    ativo: z.boolean().optional(),
    necessitaConfiguracao: z.boolean().optional(),
    cobranca: dadosCobrancaSchema.nullable().optional(),
    condicoes: condicoesCobrancaSchema.nullable().optional(),
    motivo: z.string().min(1, 'Motivo é obrigatório para alterar um médico'),
  })
  .strict();

export type NovoMedicoInput = z.infer<typeof novoMedicoSchema>;
export type AtualizarMedicoInput = z.infer<typeof atualizarMedicoSchema>;
