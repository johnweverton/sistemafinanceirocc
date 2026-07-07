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
  // Allowlist de e-mails que podem ser auto-provisionados como admin no primeiro acesso
  // (bootstrap). Qualquer usuário autenticado FORA desta lista e sem perfil recebe 403 —
  // fecha a escalação de privilégio (antes, todo usuário sem perfil virava admin).
  // Formato: e-mails separados por vírgula. Vazio = nenhum auto-provisionamento.
  BOOTSTRAP_ADMIN_EMAILS: z.string().optional(),
  // ---------------------------------------------------------------------------
  // API REAL do Sistema Web (Épico 5) — fin-clientes/fin-producoes/fin-itens.
  // ---------------------------------------------------------------------------
  API_FINANCEIRO_URL: z.string().url().optional(),
  // Achado M-2: entropia mínima de 20 caracteres quando presente.
  API_FINANCEIRO_KEY: z.string().min(20, 'API_FINANCEIRO_KEY deve ter pelo menos 20 caracteres').optional(),
  FIN_API_SOURCE: z.enum(['local', 'http']).default('local'),
  // Achado M-1: obrigatório em produção, mínimo 32 caracteres para entropia adequada.
  // Em dev (NODE_ENV !== 'production') aceita qualquer string para não bloquear DX.
  INTERNAL_SECRET: process.env.NODE_ENV === 'production'
    ? z.string().min(32, 'INTERNAL_SECRET deve ter pelo menos 32 caracteres em produção')
    : z.string().optional(),
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
  // Segredo do path do webhook do Cora (Épico 4). Comparado em tempo constante.
  // Achado M-1: entropia mínima quando presente.
  CORA_WEBHOOK_SECRET: z.string().min(16, 'CORA_WEBHOOK_SECRET deve ter pelo menos 16 caracteres').optional(),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

/** Lê o ambiente server-side. Lança se faltar variável obrigatória. Só chamar no servidor. */
export function getServerEnv() {
  return serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BOOTSTRAP_ADMIN_EMAILS: process.env.BOOTSTRAP_ADMIN_EMAILS,
    API_FINANCEIRO_URL: process.env.API_FINANCEIRO_URL,
    API_FINANCEIRO_KEY: process.env.API_FINANCEIRO_KEY,
    FIN_API_SOURCE: process.env.FIN_API_SOURCE,
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
    CORA_WEBHOOK_SECRET: process.env.CORA_WEBHOOK_SECRET,
  });
}
