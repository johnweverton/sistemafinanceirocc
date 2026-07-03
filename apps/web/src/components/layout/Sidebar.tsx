'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoCC } from '@/components/layout/LogoCC';
import { LogoutButton } from '@/components/layout/LogoutButton';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

const NAV = [
  { href: '/medicos', label: 'Médicos', icon: MedicosIcon },
  { href: '/execucoes', label: 'Execuções', icon: ExecucoesIcon },
  { href: '/recebiveis', label: 'Recebíveis', icon: RecebiveisIcon },
  { href: '/configuracoes', label: 'Configurações', icon: ConfigIcon },
];

/** Navegação lateral: fixa no desktop, drawer deslizante no mobile. */
export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Fecha o drawer ao trocar de rota.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Fecha com Escape e trava o scroll do body enquanto o drawer está aberto.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Barra superior — só no mobile */}
      <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b border-cc-hairline px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cc-hairline bg-cc-surface-2 text-cc-ink-2 transition-colors hover:border-cc-accent hover:text-cc-accent"
        >
          <HamburgerIcon />
        </button>
        <Link href="/medicos" className="logo-3d-wrap text-cc-accent">
          <LogoCC className="logo-3d logo-3d-slow h-7 w-auto drop-glow" />
        </Link>
        <ThemeToggle />
      </header>

      {/* Backdrop do drawer (mobile) */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Sidebar / Drawer */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-cc-hairline bg-cc-surface transition-transform duration-300 ease-out md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Marca */}
        <div className="flex h-16 items-center gap-3 border-b border-cc-hairline px-5">
          <Link href="/medicos" className="logo-3d-wrap group text-cc-accent">
            <LogoCC className="logo-3d logo-3d-slow h-8 w-auto drop-glow" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-cc-ink">
              Carmem Cavalcante
            </p>
            <p className="truncate font-mono text-2xs uppercase tracking-[0.2em] text-cc-muted">
              Cobrança
            </p>
          </div>
          {/* Fechar (mobile) */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-cc-muted transition-colors hover:text-cc-ink md:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Busca rápida (⌘K) */}
        <div className="p-3 pb-0">
          <button
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent('cc:open-command'))}
            className="flex w-full items-center gap-2 rounded-lg border border-cc-hairline bg-cc-surface-2 px-3 py-2 text-sm text-cc-muted transition-colors hover:border-cc-accent hover:text-cc-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="flex-1 text-left">Buscar…</span>
            <kbd className="rounded border border-cc-hairline px-1.5 py-0.5 font-mono text-2xs">⌘K</kbd>
          </button>
        </div>

        {/* Navegação */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-cc-accent-soft text-cc-accent'
                    : 'text-cc-ink-2 hover:bg-cc-surface-2 hover:text-cc-ink'
                }`}
              >
                {/* Barra de acento à esquerda no item ativo */}
                <span
                  className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cc-accent transition-opacity ${
                    active ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                <Icon className={active ? 'text-cc-accent' : 'text-cc-muted group-hover:text-cc-ink'} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Rodapé: tema + sair */}
        <div className="flex items-center justify-between gap-2 border-t border-cc-hairline p-3">
          <LogoutButton />
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}

function MedicosIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ExecucoesIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function RecebiveisIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function ConfigIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
