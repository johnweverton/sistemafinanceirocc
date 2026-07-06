import { z } from 'zod';

export const dispararExecucaoSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve ser AAAA-MM'),
  selecoes: z.array(
    z.object({
      medicoId: z.string().uuid(),
      producaoExternaId: z.string().min(1),
      producaoNome: z.string().min(1),
    })
  ).min(1, 'Selecione pelo menos um médico'),
});

export type DispararExecucaoInput = z.infer<typeof dispararExecucaoSchema>;
