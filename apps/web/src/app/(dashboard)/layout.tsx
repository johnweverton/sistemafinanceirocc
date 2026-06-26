import Link from 'next/link';
import { LogoutButton } from '@/components/layout/LogoutButton';
import { LogoCC } from '@/components/layout/LogoCC';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cc-bg">
      <header className="sticky top-0 z-10 border-b border-cc-hairline bg-cc-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-screen-lg items-center justify-between px-5">
          <Link href="/medicos" className="flex items-center">
            <LogoCC className="h-8 w-auto" />
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink href="/medicos">Medicos</NavLink>
            <NavLink href="/execucoes">Execucoes</NavLink>
            <span className="mx-1 h-4 w-px bg-cc-hairline" />
            <LogoutButton />
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
      className="rounded-md px-3 py-1.5 text-sm font-medium text-cc-blue transition-colors hover:bg-cc-accent-soft hover:text-cc-navy"
    >
      {children}
    </Link>
  );
}
