import { z } from 'zod';

export const dispararExecucaoSchema = z
  .object({
    competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve ser AAAA-MM'),
    // Cliente contábil (Story 11.3) não tem médicos pra selecionar — só nesse caso o array pode
    // vir vazio (refine abaixo). Nos demais casos (médico normal ou empresa/10.4c) continua
    // exigindo pelo menos 1 seleção.
    selecoes: z
      .array(
        z.object({
          medicoId: z.string().uuid(),
          // Nullable (mas sempre PRESENTE no payload, nunca omitido) a partir do GATE
          // 2026-08-07: médico Angiologista não tem lote principal (a produção dele vem
          // inteira de producaoCateter/Fistula/Angiografia abaixo).
          producaoExternaId: z.string().min(1).nullable(),
          producaoNome: z.string().min(1).nullable(),
          // Produção de consultas de pediatria (Story 10.2) — opcional.
          producaoConsultasExternaId: z.string().min(1).nullable().optional(),
          producaoConsultasNome: z.string().min(1).nullable().optional(),
          // Lotes separados de Outros Hospitais/Imobilizações (Story 10.5) — opcionais.
          producaoOutrosHospitaisExternaId: z.string().min(1).nullable().optional(),
          producaoOutrosHospitaisNome: z.string().min(1).nullable().optional(),
          producaoImobilizacoesExternaId: z.string().min(1).nullable().optional(),
          producaoImobilizacoesNome: z.string().min(1).nullable().optional(),
          // Lotes de Cateter/Fístula/Angiografia (médico Angiologista, GATE 2026-08-07) — opcionais.
          // Arrays desde a migration 0046 (achado 2026-08-13): a origem divide cada categoria em
          // quinzenas (1Q/2Q) como sub-lotes separados, todos somados na mesma execução.
          producaoCateterExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoCateterNomes: z.array(z.string().min(1)).nullable().optional(),
          producaoFistulaExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoFistulaNomes: z.array(z.string().min(1)).nullable().optional(),
          producaoAngiografiaExternaIds: z.array(z.string().min(1)).nullable().optional(),
          producaoAngiografiaNomes: z.array(z.string().min(1)).nullable().optional(),
          // Carta de Rede (médico Angiologista, GATE 2026-08-12) — contagem MANUAL, sem regra
          // fixa (depende do procedimento realizado no mês). producaoCartaRede* é só referência
          // de auditoria; cartaRedeGuias é o número que de fato alimenta o cálculo.
          producaoCartaRedeExternaId: z.string().min(1).nullable().optional(),
          producaoCartaRedeNome: z.string().min(1).nullable().optional(),
          cartaRedeGuias: z.number().int().min(0).nullable().optional(),
        }),
      )
      .default([]),
    // Marca a execução como agregada por empresa (Story 10.4c) — opcional.
    empresaId: z.string().uuid().optional(),
    // Marca a execução como sendo de cliente contábil (Story 11.3) — opcional.
    clienteContabilidadeId: z.string().uuid().optional(),
    // Marca a execução como o boleto avulso do adicional semestral (Story 11.4) — opcional.
    ehAdicional: z.boolean().optional(),
  })
  .refine((d) => d.selecoes.length >= 1 || !!d.clienteContabilidadeId, {
    message: 'Selecione pelo menos um médico',
    path: ['selecoes'],
  })
  .refine((d) => !(d.empresaId && d.clienteContabilidadeId), {
    message: 'Execução não pode ser de empresa e cliente contábil ao mesmo tempo',
    path: ['clienteContabilidadeId'],
  })
  .refine((d) => !d.ehAdicional || !!d.clienteContabilidadeId, {
    message: 'Adicional semestral só é válido para execução de cliente contábil',
    path: ['ehAdicional'],
  });

export type DispararExecucaoInput = z.infer<typeof dispararExecucaoSchema>;
