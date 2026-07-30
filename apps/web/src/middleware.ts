// Protege rotas: sem sessão Supabase válida, redireciona para /login (architecture).
// Achado A-4: gera nonce CSP por request e injeta no header Content-Security-Policy,
// permitindo remover 'unsafe-inline' de script-src em produção.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { createRateLimiter, checkLimit } from '@/lib/rate-limit';

// Rate limit GLOBAL para todas as rotas /api/*, por usuário autenticado — defesa em
// profundidade complementar aos limiters pontuais (rate-limit.ts) das rotas de maior custo.
// Objetivo aqui é diferente: impedir scraping em massa de dados pessoais (médicos, execuções,
// financeiro) por uma sessão comprometida ou automatizada, não limitar operações caras isoladas.
// 300 req/min é generoso o bastante para não afetar o uso normal do dashboard (várias
// chamadas paralelas por tela) mas barra varredura sistemática em poucos segundos.
const apiGlobalLimiter = createRateLimiter('api-global', { limit: 300, windowMs: 60_000 });

export async function middleware(req: NextRequest) {
  // 1. Gerar nonce criptográfico para esta request (Achado A-4).
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // 2. Montar CSP dinâmica com nonce no script-src.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : '';
  const supabaseWss = supabaseOrigin ? supabaseOrigin.replace(/^https:/, 'wss:') : '';
  const isDev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    // Nonce substitui 'unsafe-inline' para scripts; 'unsafe-eval' só em dev (HMR).
    // 'strict-dynamic' permite que scripts com nonce carreguem outros scripts (chunks Next.js).
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''} 'strict-dynamic'`,
    // style-src mantém 'unsafe-inline': necessário para Tailwind/shadcn (estilos inline do framework).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseWss}` : ''} https://viacep.com.br`,
    // PWA: registro do service worker (public/sw.js) cai em worker-src, que sem
    // esta diretiva herdaria de script-src — e 'strict-dynamic' ali ignora 'self'.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  // 3. Clonar headers do request para injetar o nonce (acessível pelo layout via headers()).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // 4. Headers de segurança na resposta (movidos de next.config.mjs para cá, pois a CSP agora é dinâmica).
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-DNS-Prefetch-Control', 'off');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

  // Exceção deliberada ao "só lib/env.ts lê process.env": o middleware roda no Edge
  // runtime e só precisa das duas chaves públicas; importar o env.ts (que valida com
  // Zod no import) aqui não agrega — são variáveis NEXT_PUBLIC, sempre presentes no build.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLogin = req.nextUrl.pathname.startsWith('/login');
  if (!user && !isLogin) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (user && isLogin) {
    return NextResponse.redirect(new URL('/medicos', req.url));
  }

  // Rate limit global de API — só se aplica após autenticação resolvida (LGPD: contém
  // dados pessoais). Rotas de saúde/webhooks já ficam fora do matcher deste middleware.
  if (user && req.nextUrl.pathname.startsWith('/api/')) {
    const { allowed, resetAt } = checkLimit(apiGlobalLimiter, user.id);
    if (!allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Limite de requisições excedido. Tente novamente em instantes.',
            timestamp: new Date().toISOString(),
          },
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)) } },
      );
    }
  }

  return res;
}

export const config = {
  // Protege tudo exceto assets estáticos, o endpoint de saúde e os webhooks públicos.
  // Webhooks NÃO usam sessão — a segurança é o secret no path + reconsulta na API Cora.
  // manifest/sw.js/icons/logo precisam ficar fora do gate de auth: o navegador os busca
  // mesmo deslogado (tela de login, instalação do PWA), e um redirect para /login quebraria
  // o parse do manifest e o registro do service worker (SecurityError em fetch redirecionado).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|logo.svg|api/health|api/webhooks).*)',
  ],
};

