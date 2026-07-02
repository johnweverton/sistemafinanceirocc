/** @type {import('next').NextConfig} */

// Origem do Supabase (REST + Auth via https, Realtime via wss) para liberar no connect-src
// da CSP sem abrir para qualquer host. Derivada da env pública; fallback para não quebrar build.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : '';
const supabaseWss = supabaseOrigin ? supabaseOrigin.replace(/^https:/, 'wss:') : '';

const isDev = process.env.NODE_ENV !== 'production';

// CSP pragmática: bloqueia origens externas de script, framing e objetos, permitindo o que
// Next/GSAP/Supabase precisam. 'unsafe-eval' só em dev (HMR). Pode ser endurecida depois com
// nonces por request (framework de segurança futuro).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseWss}` : ''} https://viacep.com.br`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // remove header X-Powered-By (evita fingerprinting do stack)
  // packages/shared é TS puro consumido direto da fonte — transpilado pelo Next.
  transpilePackages: ['@cobranca/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
