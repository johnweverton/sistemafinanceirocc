import { z } from 'zod';

export const dispararExecucaoSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve ser AAAA-MM'),
  selecoes: z.array(
    z.object({
      medicoId: z.string().uuid(),
      producaoExternaId: z.string().min(1),
      producaoNome: z.string().min(1),
      // Produção de consultas de pediatria (Story 10.2) — opcional.
      producaoConsultasExternaId: z.string().min(1).nullable().optional(),
      producaoConsultasNome: z.string().min(1).nullable().optional(),
    })
  ).min(1, 'Selecione pelo menos um médico'),
  // Marca a execução como agregada por empresa (Story 10.4c) — opcional.
  empresaId: z.string().uuid().optional(),
});

export type DispararExecucaoInput = z.infer<typeof dispararExecucaoSchema>;
