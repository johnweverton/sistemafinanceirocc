// Schemas Zod de validação de input das rotas de médico (architecture: Input Validation).
import { z } from 'zod';

export const statusHapvidaSchema = z.enum(['credenciado', 'nao_credenciado', 'nenhum']);
export const modoMudancaDataSchema = z.enum(['sim', 'nao']);

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
    motivo: z.string().min(1, 'Motivo é obrigatório para alterar um médico'),
  })
  .strict();

export type NovoMedicoInput = z.infer<typeof novoMedicoSchema>;
export type AtualizarMedicoInput = z.infer<typeof atualizarMedicoSchema>;
