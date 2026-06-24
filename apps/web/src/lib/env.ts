// Acesso a variáveis de ambiente — único ponto que lê process.env (Coding Standard).
// Variáveis server-side só são lidas em código de servidor; este módulo nunca deve
// ser importado por Client Components que precisem das chaves secretas.
import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CARMEM_API_URL: z.string().url().optional(),
  CARMEM_API_KEY: z.string().optional(),
  PROCEDIMENTOS_SOURCE: z.enum(['local', 'http']).default('local'),
  INTERNAL_SECRET: z.string().optional(),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

/** Lê o ambiente server-side. Lança se faltar variável obrigatória. Só chamar no servidor. */
export function getServerEnv() {
  return serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CARMEM_API_URL: process.env.CARMEM_API_URL,
    CARMEM_API_KEY: process.env.CARMEM_API_KEY,
    PROCEDIMENTOS_SOURCE: process.env.PROCEDIMENTOS_SOURCE,
    INTERNAL_SECRET: process.env.INTERNAL_SECRET,
  });
}
