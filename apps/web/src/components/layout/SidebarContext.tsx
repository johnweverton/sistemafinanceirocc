'use client';
import { createContext, useContext, useEffect, useState } from 'react';

const CHAVE_COLAPSADA = 'cc-sidebar-collapsed';

interface SidebarContextValue {
  /** Recolhida de fato (já considerando ter montado — evita mismatch de hidratação). */
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Estado do colapso do sidebar, compartilhado entre `Sidebar.tsx` (que renderiza o botão de
 * recolher) e o layout (que precisa ajustar o `padding-left` do `<main>` de acordo — antes
 * cada um vivia isolado, o layout sempre usava um padding fixo e recolher o menu não liberava
 * espaço nenhum de verdade, feedback do dono 2026-08-03).
 */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(CHAVE_COLAPSADA) === '1') setCollapsed(true);
    } catch {
      /* localStorage indisponível — mantém o default */
    }
    setMounted(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((atual) => {
      const proximo = !atual;
      try {
        localStorage.setItem(CHAVE_COLAPSADA, proximo ? '1' : '0');
      } catch {
        /* localStorage indisponível — ignora */
      }
      return proximo;
    });
  }

  // Só considera "recolhida" de fato depois de montar (evita flash com o valor padrão antes do
  // localStorage ser lido).
  return (
    <SidebarContext.Provider value={{ collapsed: mounted && collapsed, toggleCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar precisa estar dentro de <SidebarProvider>');
  return ctx;
}
