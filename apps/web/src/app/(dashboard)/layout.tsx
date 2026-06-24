export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-6 border-b pb-3">
        <span className="text-sm font-semibold text-gray-700">
          Cobrança por Guias — Carmem Cavalcante
        </span>
      </header>
      {children}
    </div>
  );
}
