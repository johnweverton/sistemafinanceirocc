// Schemas Zod de validação de input das rotas de cliente contábil (Story 11.1, Epic 11).
// Reaproveita deliberadamente os blocos já validados para médico/empresa — mesmo domínio de
// cobrança (DadosCobranca, CondicoesCobranca, RegraPreco, ContaEmissora). Não duplicar as regras
// de validação aqui.
import { z } from 'zod';
import {
  dadosCobrancaSchema,
  condicoesCobrancaSchema,
  regraPrecoSchema,
  contaEmissoraSchema,
} from './medico-schema';

export const regimeTributarioSchema = z.enum(['simples_nacional', 'lucro_presumido']);
export const modoCobrancaContabilidadeSchema = z.enum(['faixa_faturamento', 'fixo']);

/**
 * Adicional semestral (ex.: Vital Soluções — R$15.000 a cada 6 meses): quando ativo, exige
 * valor + intervalo + competência base preenchidos (espelho da CHECK
 * chk_clientes_contabilidade_adicional_coerente, migration 0030).
 */
function adicionalCoerente(d: {
  adicionalAtivo?: boolean;
  adicionalValor?: number | null;
  adicionalIntervaloMeses?: number | null;
  adicionalCompetenciaBase?: string | null;
}): boolean {
  if (!d.adicionalAtivo) return true;
  return d.adicionalValor != null && d.adicionalIntervaloMeses != null && !!d.adicionalCompetenciaBase;
}
const MSG_ADICIONAL =
  'Adicional semestral ativo exige valor, intervalo em meses e competência base preenchidos';

const competenciaSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência deve estar no formato YYYY-MM');

export const novoClienteContabilidadeSchema = z
  .object({
    nome: z.string().min(1, 'Nome é obrigatório'),
    regimeTributario: regimeTributarioSchema,
    modoCobranca: modoCobrancaContabilidadeSchema,
    cobranca: dadosCobrancaSchema.nullable().optional().default(null),
    contaEmissora: contaEmissoraSchema.optional(),
    condicoes: condicoesCobrancaSchema.nullable().optional().default(null),
    regraPreco: regraPrecoSchema.nullable().optional().default(null),
    adicionalAtivo: z.boolean().default(false),
    adicionalValor: z.number().min(0).nullable().optional().default(null),
    adicionalIntervaloMeses: z.number().int().min(1).nullable().optional().default(null),
    adicionalCompetenciaBase: competenciaSchema.nullable().optional().default(null),
    ativo: z.boolean().default(true),
  })
  .refine(adicionalCoerente, { message: MSG_ADICIONAL, path: ['adicionalValor'] });

export const atualizarClienteContabilidadeSchema = z
  .object({
    nome: z.string().min(1).optional(),
    regimeTributario: regimeTributarioSchema.optional(),
    modoCobranca: modoCobrancaContabilidadeSchema.optional(),
    cobranca: dadosCobrancaSchema.nullable().optional(),
    contaEmissora: contaEmissoraSchema.optional(),
    condicoes: condicoesCobrancaSchema.nullable().optional(),
    regraPreco: regraPrecoSchema.nullable().optional(),
    adicionalAtivo: z.boolean().optional(),
    adicionalValor: z.number().min(0).nullable().optional(),
    adicionalIntervaloMeses: z.number().int().min(1).nullable().optional(),
    adicionalCompetenciaBase: competenciaSchema.nullable().optional(),
    ativo: z.boolean().optional(),
    motivo: z.string().min(1, 'Motivo é obrigatório para alterar um cliente contábil'),
  })
  .strict()
  .refine(adicionalCoerente, { message: MSG_ADICIONAL, path: ['adicionalValor'] });

export const excluirClientesContabilidadeSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, 'Informe pelo menos um cliente'),
  })
  .strict();

export type NovoClienteContabilidadeInput = z.infer<typeof novoClienteContabilidadeSchema>;
export type AtualizarClienteContabilidadeInput = z.infer<typeof atualizarClienteContabilidadeSchema>;

/** Lançamento de faturamento mensal (Story 11.2) — usado pelo modo `faixa_faturamento`. */
export const lancarFaturamentoSchema = z
  .object({
    competencia: competenciaSchema,
    faturamento: z.number().min(0, 'Faturamento não pode ser negativo'),
  })
  .strict();

export type LancarFaturamentoInput = z.infer<typeof lancarFaturamentoSchema>;

// Lançamento de faturamento EM MASSA (feedback do dono, 2026-08-20) — mesma competência pra
// vários clientes `faixa_faturamento` de uma vez, passo que precede o cálculo em lote (o valor do
// boleto desse modo depende do faturamento já lançado, nunca é derivável sozinho).
export const lancarFaturamentoLoteSchema = z
  .object({
    competencia: competenciaSchema,
    lancamentos: z
      .array(
        z.object({
          clienteContabilidadeId: z.string().uuid(),
          faturamento: z.number().min(0, 'Faturamento não pode ser negativo'),
        }),
      )
      .min(1, 'Informe ao menos um lançamento')
      .max(200, 'Máximo de 200 lançamentos por vez'),
  })
  .strict();

export type LancarFaturamentoLoteInput = z.infer<typeof lancarFaturamentoLoteSchema>;
