// Validação do payload do agente ISS (Story 13.1, Épico 13). O agente é código nosso, mas roda
// fora do servidor — o payload é tratado como entrada externa, igual a qualquer outra rota.
import { z } from 'zod';
import { AGENTE_ISS_MAX_CAPTURAS } from '@cobranca/shared';

export const competenciaIssSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência deve estar no formato YYYY-MM');

const textoCurto = (max: number) => z.string().trim().max(max).nullable().default(null);

const capturaSchema = z
  .object({
    clienteContabilidadeId: z.string().uuid(),
    status: z.enum(['capturado', 'nao_encontrado', 'sem_escrituracao', 'erro']),
    valorServicosPrestados: z.number().finite().min(0, 'Valor não pode ser negativo').nullable().default(null),
    quantidadeNotas: z.number().int().min(0).nullable().default(null),
    situacaoIss: textoCurto(120),
    competenciaFechada: z.boolean().nullable().default(null),
    inscricaoMunicipal: textoCurto(30),
    razaoSocialIss: textoCurto(200),
    mensagemErro: textoCurto(1000),
    capturadoEm: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((c) => c.status !== 'capturado' || c.valorServicosPrestados !== null, {
    message: "Captura com status 'capturado' exige valorServicosPrestados",
    path: ['valorServicosPrestados'],
  });

const cienciaSchema = z
  .object({
    documento: z.string().regex(/^\d{11}$|^\d{14}$/, 'Documento deve ter 11 ou 14 dígitos'),
    inscricaoMunicipal: textoCurto(30),
    assunto: z.string().trim().min(1).max(500),
    dataComunicado: textoCurto(30),
    arquivo: z.string().trim().min(1).max(500),
    cienciaEm: z.string().datetime({ offset: true }),
  })
  .strict();

export const novaExecucaoIssSchema = z
  .object({
    competencia: competenciaIssSchema,
    iniciadoEm: z.string().datetime({ offset: true }),
    finalizadoEm: z.string().datetime({ offset: true }).nullable().default(null),
    maquina: textoCurto(100),
    versaoAgente: textoCurto(40),
    capturas: z
      .array(capturaSchema)
      .min(1, 'Envie ao menos uma captura')
      .max(AGENTE_ISS_MAX_CAPTURAS, `Máximo de ${AGENTE_ISS_MAX_CAPTURAS} capturas por execução`),
    ciencias: z.array(cienciaSchema).max(AGENTE_ISS_MAX_CAPTURAS).default([]),
  })
  .strict()
  .refine(
    (e) => new Set(e.capturas.map((c) => c.clienteContabilidadeId)).size === e.capturas.length,
    { message: 'Cliente repetido na mesma execução', path: ['capturas'] },
  );

export type NovaExecucaoIssInput = z.infer<typeof novaExecucaoIssSchema>;
