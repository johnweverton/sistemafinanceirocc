import { z } from 'zod';

export const dispararExecucaoSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve ser AAAA-MM'),
});

export type DispararExecucaoInput = z.infer<typeof dispararExecucaoSchema>;
