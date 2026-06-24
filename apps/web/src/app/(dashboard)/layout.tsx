import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between border-b pb-3">
        <span className="text-sm font-semibold text-gray-700">
          Cobrança por Guias — Carmem Cavalcante
        </span>
        <nav className="flex gap-4 text-sm">
          <Link href="/medicos" className="text-gray-600 hover:underline">
            Médicos
          </Link>
          <Link href="/execucoes" className="text-gray-600 hover:underline">
            Execuções
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
