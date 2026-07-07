import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Outfit, JetBrains_Mono } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Cobrança por Guias | Carmem Cavalcante',
  description: 'Sistema de cobrança por guias hospitalares',
  icons: {
    icon: '/logo.svg?v=2',
  },
};

// Aplica o tema salvo ANTES da primeira pintura, evitando flash de tema errado.
// Dark é o padrão.
const themeScript = `(function(){try{var t=localStorage.getItem('cc-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Achado A-4: nonce gerado pelo middleware (x-nonce header) — permite CSP sem 'unsafe-inline'.
  const nonce = headers().get('x-nonce') ?? '';

  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      className={`${outfit.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Achado B-1 (SEGURANÇA): Este é o ÚNICO uso aceito de dangerouslySetInnerHTML no projeto.
          O themeScript é uma CONSTANTE LITERAL definida neste arquivo — NÃO recebe input do usuário.
          Ele aplica o tema salvo em localStorage antes da primeira pintura (evita flash).
          O nonce CSP gerado por request (middleware) autoriza este script inline.
          NÃO copie este padrão para outros componentes sem revisão de segurança.
        */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <SpeedInsights />
      </body>
    </html>
  );
}

