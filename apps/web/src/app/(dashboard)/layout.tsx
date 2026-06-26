import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cc-bg">
      <header className="sticky top-0 z-10 border-b border-cc-hairline bg-cc-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-screen-lg items-center justify-between px-5">
          <Link href="/medicos" className="flex items-center gap-2.5 group">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cc-accent text-xs font-bold text-white tracking-tight shadow-cc-sm">
              CC
            </span>
            <span className="text-sm font-semibold text-cc-ink tracking-tight">
              Carmem Cavalcante
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink href="/medicos">Medicos</NavLink>
            <NavLink href="/execucoes">Execucoes</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-screen-lg px-5 py-8">
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-cc-ink-2 transition-colors hover:bg-cc-bg hover:text-cc-ink"
    >
      {children}
    </Link>
  );
}
