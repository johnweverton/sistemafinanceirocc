import { Sidebar } from '@/components/layout/Sidebar';
import { CommandPalette } from '@/components/layout/CommandPalette';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cc-bg">
      <Sidebar />
      <CommandPalette />
      {/* Conteúdo deslocado à direita da sidebar no desktop (largura w-64 = 16rem). */}
      <main className="md:pl-64">
        <div className="mx-auto max-w-screen-lg px-5 py-8">{children}</div>
      </main>
    </div>
  );
}
