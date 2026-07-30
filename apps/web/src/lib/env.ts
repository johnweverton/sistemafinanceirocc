// Acesso a variáveis de ambiente — único ponto que lê process.env (Coding Standard).
// Variáveis server-side só são lidas em código de servidor; este módulo nunca deve
// ser importado por Client Components que precisem das chaves secretas.
import { z } from 'zod';
import type { ContaEmissora } from '@cobranca/shared';

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
  // API REAL do Sistema Web — fin-clientes/fin-producoes/fin-itens.
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
  // Quantos médicos processar em paralelo dentro de um lote (chamadas à API da Carmem).
  // Ajustável sem deploy caso a origem reaja mal a rajadas (429). Default conservador: 8.
  EXECUCAO_CONCORRENCIA_MEDICO: z.string().regex(/^\d+$/).transform(Number).default('8'),

  // ---------------------------------------------------------------------------
  // GATEWAY DE BOLETOS — Fase 3 (Cora mTLS)
  // ---------------------------------------------------------------------------
  // Feature flag principal: bloqueia emissão mesmo via API até alguém decidir ligar.
  GATEWAY_EMISSAO_HABILITADA: z.enum(['true', 'false']).default('false'),
  // Qual gateway usar: 'cora' (real, mTLS) ou 'mock' (testes/dev).
  BOLETO_GATEWAY: z.enum(['cora', 'mock']).default('mock'),
  // Status devolvido pela reconsulta (consultarInvoice) do MockGateway em dev (débito M-1):
  // 'paid' (default) testa webhook/baixa; 'open' permite testar o CANCELAMENTO (com 'paid',
  // todo cancelamento em mock cai no ramo de corrida e grava baixa falsa).
  MOCK_INVOICE_STATUS: z.enum(['paid', 'open', 'overdue', 'canceled', 'unknown']).default('paid'),
  // Certificado e chave privada mTLS da Cora, em base64.
  CORA_CERT_BASE64: z.string().optional(),
  CORA_KEY_BASE64: z.string().optional(),
  // URL base da API Banking da Cora (ex.: https://api.cora.com.br).
  CORA_API_URL: z.string().url().optional(),
  // Client ID da Cora para autenticação OAuth2 + mTLS.
  CORA_CLIENT_ID: z.string().optional(),
  // Segredo do path do webhook do Cora. Comparado em tempo constante.
  // Achado M-1: entropia mínima quando presente.
  CORA_WEBHOOK_SECRET: z.string().min(16, 'CORA_WEBHOOK_SECRET deve ter pelo menos 16 caracteres').optional(),

  // ---------------------------------------------------------------------------
  // MULTI-CONTA EMISSORA — credenciais por conta, prefixadas.
  // As CORA_* legadas (acima) valem como FALLBACK da conta 'mc': deploy sem env
  // nova = comportamento atual. A CV só opera quando CORA_CV_* for configurada.
  // ---------------------------------------------------------------------------
  CORA_MC_CERT_BASE64: z.string().optional(),
  CORA_MC_KEY_BASE64: z.string().optional(),
  CORA_MC_API_URL: z.string().url().optional(),
  CORA_MC_CLIENT_ID: z.string().optional(),
  CORA_MC_WEBHOOK_SECRET: z.string().min(16, 'CORA_MC_WEBHOOK_SECRET deve ter pelo menos 16 caracteres').optional(),
  CORA_CV_CERT_BASE64: z.string().optional(),
  CORA_CV_KEY_BASE64: z.string().optional(),
  CORA_CV_API_URL: z.string().url().optional(),
  CORA_CV_CLIENT_ID: z.string().optional(),
  CORA_CV_WEBHOOK_SECRET: z.string().min(16, 'CORA_CV_WEBHOOK_SECRET deve ter pelo menos 16 caracteres').optional(),
  
  // ---------------------------------------------------------------------------
  // DISPARO DE MENSAGENS — WhatsApp (Zappy) e E-mail (SMTP UOL)
  // ---------------------------------------------------------------------------
  ZAPPY_API_URL: z.string().url().optional(),
  ZAPPY_API_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().regex(/^\d+$/).transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
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
    EXECUCAO_CONCORRENCIA_MEDICO: process.env.EXECUCAO_CONCORRENCIA_MEDICO,
    GATEWAY_EMISSAO_HABILITADA: process.env.GATEWAY_EMISSAO_HABILITADA,
    BOLETO_GATEWAY: process.env.BOLETO_GATEWAY,
    MOCK_INVOICE_STATUS: process.env.MOCK_INVOICE_STATUS,
    CORA_CERT_BASE64: process.env.CORA_CERT_BASE64,
    CORA_KEY_BASE64: process.env.CORA_KEY_BASE64,
    CORA_API_URL: process.env.CORA_API_URL,
    CORA_CLIENT_ID: process.env.CORA_CLIENT_ID,
    CORA_WEBHOOK_SECRET: process.env.CORA_WEBHOOK_SECRET,
    CORA_MC_CERT_BASE64: process.env.CORA_MC_CERT_BASE64,
    CORA_MC_KEY_BASE64: process.env.CORA_MC_KEY_BASE64,
    CORA_MC_API_URL: process.env.CORA_MC_API_URL,
    CORA_MC_CLIENT_ID: process.env.CORA_MC_CLIENT_ID,
    CORA_MC_WEBHOOK_SECRET: process.env.CORA_MC_WEBHOOK_SECRET,
    CORA_CV_CERT_BASE64: process.env.CORA_CV_CERT_BASE64,
    CORA_CV_KEY_BASE64: process.env.CORA_CV_KEY_BASE64,
    CORA_CV_API_URL: process.env.CORA_CV_API_URL,
    CORA_CV_CLIENT_ID: process.env.CORA_CV_CLIENT_ID,
    CORA_CV_WEBHOOK_SECRET: process.env.CORA_CV_WEBHOOK_SECRET,
    ZAPPY_API_URL: process.env.ZAPPY_API_URL,
    ZAPPY_API_TOKEN: process.env.ZAPPY_API_TOKEN,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
  });
}

// ---------------------------------------------------------------------------
// Credenciais por conta emissora
// ---------------------------------------------------------------------------

/** Credenciais mTLS/OAuth de UMA conta Cora, já resolvidas (prefixadas ?? legadas). */
export interface CredenciaisConta {
  certBase64: string;
  keyBase64: string;
  apiUrl: string;
  clientId: string;
  /** Secret do webhook desta conta; null se não configurado (não bloqueia emissão). */
  webhookSecret: string | null;
}

/**
 * Resolve as credenciais da conta emissora a partir das env vars prefixadas
 * (CORA_MC_* / CORA_CV_*). Para 'mc', as CORA_* legadas valem como fallback —
 * deploy sem env nova mantém a MC funcionando exatamente como hoje.
 * Lança erro nomeando a conta e as vars faltantes; a outra conta não é afetada.
 */
export function getCredenciaisConta(conta: ContaEmissora): CredenciaisConta {
  const env = getServerEnv();

  const fontes =
    conta === 'mc'
      ? {
          certBase64: { valor: env.CORA_MC_CERT_BASE64 ?? env.CORA_CERT_BASE64, var: 'CORA_MC_CERT_BASE64 (ou CORA_CERT_BASE64)' },
          keyBase64: { valor: env.CORA_MC_KEY_BASE64 ?? env.CORA_KEY_BASE64, var: 'CORA_MC_KEY_BASE64 (ou CORA_KEY_BASE64)' },
          apiUrl: { valor: env.CORA_MC_API_URL ?? env.CORA_API_URL, var: 'CORA_MC_API_URL (ou CORA_API_URL)' },
          clientId: { valor: env.CORA_MC_CLIENT_ID ?? env.CORA_CLIENT_ID, var: 'CORA_MC_CLIENT_ID (ou CORA_CLIENT_ID)' },
          webhookSecret: env.CORA_MC_WEBHOOK_SECRET ?? env.CORA_WEBHOOK_SECRET ?? null,
        }
      : {
          certBase64: { valor: env.CORA_CV_CERT_BASE64, var: 'CORA_CV_CERT_BASE64' },
          keyBase64: { valor: env.CORA_CV_KEY_BASE64, var: 'CORA_CV_KEY_BASE64' },
          apiUrl: { valor: env.CORA_CV_API_URL, var: 'CORA_CV_API_URL' },
          clientId: { valor: env.CORA_CV_CLIENT_ID, var: 'CORA_CV_CLIENT_ID' },
          webhookSecret: env.CORA_CV_WEBHOOK_SECRET ?? null,
        };

  const faltantes = (['certBase64', 'keyBase64', 'apiUrl', 'clientId'] as const)
    .filter((campo) => !fontes[campo].valor)
    .map((campo) => fontes[campo].var);

  if (faltantes.length > 0) {
    throw new Error(
      `Credenciais da conta emissora '${conta}' não configuradas. ` +
        `Variáveis faltantes: ${faltantes.join(', ')}. ` +
        'Emissões pelas demais contas não são afetadas.',
    );
  }

  return {
    certBase64: fontes.certBase64.valor!,
    keyBase64: fontes.keyBase64.valor!,
    apiUrl: fontes.apiUrl.valor!,
    clientId: fontes.clientId.valor!,
    webhookSecret: fontes.webhookSecret,
  };
}
