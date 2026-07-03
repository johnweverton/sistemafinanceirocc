// Protege rotas: sem sessão Supabase válida, redireciona para /login (architecture).
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
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
