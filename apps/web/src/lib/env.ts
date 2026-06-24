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
  // Base URL da própria app, usada pela função para se auto-invocar entre lotes (Fase 2).
  // Em Vercel, derivar de VERCEL_URL; local, http://localhost:3000.
  APP_BASE_URL: z.string().url().optional(),

  // ---------------------------------------------------------------------------
  // GATEWAY DE BOLETOS — Fase 3 (Cora mTLS)
  // ---------------------------------------------------------------------------
  // Feature flag principal: bloqueia emissão mesmo via API até alguém decidir ligar.
  GATEWAY_EMISSAO_HABILITADA: z.enum(['true', 'false']).default('false'),
  // Qual gateway usar: 'cora' (real, mTLS) ou 'mock' (testes/dev).
  BOLETO_GATEWAY: z.enum(['cora', 'mock']).default('mock'),
  // Certificado e chave privada mTLS da Cora, em base64.
  CORA_CERT_BASE64: z.string().optional(),
  CORA_KEY_BASE64: z.string().optional(),
  // URL base da API Banking da Cora (ex.: https://api.cora.com.br).
  CORA_API_URL: z.string().url().optional(),
  // Client ID da Cora para autenticação OAuth2 + mTLS.
  CORA_CLIENT_ID: z.string().optional(),
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
    APP_BASE_URL:
      process.env.APP_BASE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined),
    GATEWAY_EMISSAO_HABILITADA: process.env.GATEWAY_EMISSAO_HABILITADA,
    BOLETO_GATEWAY: process.env.BOLETO_GATEWAY,
    CORA_CERT_BASE64: process.env.CORA_CERT_BASE64,
    CORA_KEY_BASE64: process.env.CORA_KEY_BASE64,
    CORA_API_URL: process.env.CORA_API_URL,
    CORA_CLIENT_ID: process.env.CORA_CLIENT_ID,
  });
}
