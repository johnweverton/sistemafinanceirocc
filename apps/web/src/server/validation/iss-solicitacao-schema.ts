// Validação das solicitações de busca no ISS (Story 13.5, Épico 13). Dois públicos:
//   - o OPERADOR (sessão), que pede a busca no diálogo de lote — `novaSolicitacaoIssSchema`;
//   - o AGENTE (bearer token), que reivindica, relata progresso e conclui — os demais schemas.
// O agente é código nosso, mas roda fora do servidor: o corpo é entrada externa, como em
// agente-iss-schema.ts.
import { z } from 'zod';
import { AGENTE_ISS_MAX_CAPTURAS } from '@cobranca/shared';
import { competenciaIssSchema } from './agente-iss-schema';

/** CPF/CNPJ aceito com ou sem máscara; sai só com dígitos (é assim que o agente pesquisa no portal). */
const documentoSchema = z
  .string()
  .transform((d) => d.replace(/\D/g, ''))
  .refine((d) => d.length === 11 || d.length === 14, 'Documento deve ter 11 ou 14 dígitos');

export const novaSolicitacaoIssSchema = z
  .object({
    competencia: competenciaIssSchema,
    // Obrigatório: a busca lê só as empresas do lote que o operador abriu (ou a do "Tentar de
    // novo"). Pedir a carteira inteira sem querer custa ~30 min e vários logins no portal — e era
    // o que uma tela antiga (sem recarregar) fazia ao omitir o campo.
    documentos: z
      .array(documentoSchema, {
        required_error: 'Informe as empresas da busca — recarregue a página e tente de novo',
      })
      .min(1, 'Informe ao menos uma empresa para buscar no ISS')
      .max(AGENTE_ISS_MAX_CAPTURAS)
      .transform((docs) => [...new Set(docs)]),
  })
  .strict();

export type NovaSolicitacaoIssInput = z.infer<typeof novaSolicitacaoIssSchema>;

/** `GET .../solicitacoes/proxima?maquina=NOME` — nome da máquina do escritório, só para a UI/auditoria. */
export const reivindicarSolicitacaoIssSchema = z.object({
  maquina: z.string().trim().max(100).nullable().default(null),
});

export const progressoSolicitacaoIssSchema = z
  .object({
    atual: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict()
  .refine((p) => p.atual <= p.total, { message: 'atual não pode passar de total', path: ['atual'] });

export type ProgressoSolicitacaoIssInput = z.infer<typeof progressoSolicitacaoIssSchema>;

// Sucesso XOR falha — mesmo espírito do `status`/`mensagemErro` das capturas (Story 13.1). Os dois
// ramos são estritos: `{ execucaoId, erro }` junto não casa com nenhum e vira 422.
export const conclusaoSolicitacaoIssSchema = z.union([
  z.object({ execucaoId: z.string().uuid() }).strict(),
  z.object({ erro: z.string().trim().min(1).max(1000) }).strict(),
]);

export type ConclusaoSolicitacaoIssInput = z.infer<typeof conclusaoSolicitacaoIssSchema>;

export const idSolicitacaoIssSchema = z.string().uuid('Identificador de solicitação inválido');
