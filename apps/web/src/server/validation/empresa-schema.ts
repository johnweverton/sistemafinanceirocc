// Schemas Zod de validação de input das rotas de empresa (Story 10.4a, Épico 10).
// Reaproveita deliberadamente os blocos já validados para médico — mesmo domínio de cobrança
// (DadosCobranca, CondicoesCobranca, RegraPreco, ContaEmissora) aplicado a um agregado
// multi-médico em vez de a um médico só. Não duplicar as regras de validação aqui.
import { z } from 'zod';
import {
  dadosCobrancaSchema,
  condicoesCobrancaSchema,
  regraPrecoSchema,
  contaEmissoraSchema,
} from './medico-schema';

export const novaEmpresaSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  cobranca: dadosCobrancaSchema.nullable().optional().default(null),
  contaEmissora: contaEmissoraSchema.optional(),
  condicoes: condicoesCobrancaSchema.nullable().optional().default(null),
  regraPreco: regraPrecoSchema.nullable().optional().default(null),
  ativo: z.boolean().default(true),
});

export const atualizarEmpresaSchema = z
  .object({
    nome: z.string().min(1).optional(),
    cobranca: dadosCobrancaSchema.nullable().optional(),
    contaEmissora: contaEmissoraSchema.optional(),
    condicoes: condicoesCobrancaSchema.nullable().optional(),
    regraPreco: regraPrecoSchema.nullable().optional(),
    ativo: z.boolean().optional(),
    motivo: z.string().min(1, 'Motivo é obrigatório para alterar uma empresa'),
  })
  .strict();

export type NovaEmpresaInput = z.infer<typeof novaEmpresaSchema>;
export type AtualizarEmpresaInput = z.infer<typeof atualizarEmpresaSchema>;
