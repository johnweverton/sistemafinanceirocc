// Protege rotas: sem sessão Supabase válida, redireciona para /login (architecture).
// Achado A-4: gera nonce CSP por request e injeta no header Content-Security-Policy,
// permitindo remover 'unsafe-inline' de script-src em produção.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
  return res;
}

export const config = {
  // Protege tudo exceto assets estáticos, o endpoint de saúde e os webhooks públicos.
  // Webhooks NÃO usam sessão — a segurança é o secret no path + reconsulta na API Cora (Épico 4).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks).*)'],
};

