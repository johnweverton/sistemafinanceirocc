'use client';
import { Sidebar } from '@/components/layout/Sidebar';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { SidebarProvider, useSidebar } from '@/components/layout/SidebarContext';

function Conteudo({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <main className={collapsed ? 'md:pl-[76px]' : 'md:pl-64'}>
      <div className="mx-auto max-w-[1600px] px-5 py-8">{children}</div>
    </main>
  );
}

/** Casca do dashboard: sidebar + conteúdo, com o padding do conteúdo reagindo ao colapso do
 *  sidebar (antes era fixo — recolher o menu não liberava espaço nenhum de verdade, feedback
 *  do dono 2026-08-03). Largura do conteúdo subiu de max-w-screen-lg (1024px) pra 1600px pelo
 *  mesmo motivo — em telas largas, tabelas (ex.: Recebíveis) caíam em scroll horizontal
 *  desnecessário com espaço de sobra na tela. */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen bg-cc-bg">
        <Sidebar />
        <CommandPalette />
        <Conteudo>{children}</Conteudo>
      </div>
    </SidebarProvider>
  );
}
