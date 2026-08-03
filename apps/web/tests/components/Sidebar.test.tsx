// Teste de componente — Sidebar. Cobre: agrupamento por seção separando Cobrança Médica de
// Contabilidade (reorganização UX 2026-07-24) e, a partir do polimento UX de 2026-07-30, o
// accordion das seções (item 3) e o colapso do modo desktop (item 1) — ambos persistidos em
// localStorage, mesmo padrão de ThemeToggle.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('../../src/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { Sidebar } from '../../src/components/layout/Sidebar';
import { SidebarProvider } from '../../src/components/layout/SidebarContext';

// Sidebar lê o colapso de <SidebarProvider> (compartilhado com o layout — o padding do <main>
// precisa saber o mesmo estado, feedback do dono 2026-08-03), então todo render precisa do
// provider por fora, mesmo padrão de qualquer contexto React em teste de componente.
function renderSidebar() {
  return render(
    <SidebarProvider>
      <Sidebar />
    </SidebarProvider>,
  );
}

describe('Sidebar — agrupamento por seção (2026-07-24)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mostra os rótulos de seção "Cobrança Médica" e "Contabilidade"', () => {
    renderSidebar();
    expect(screen.getByText('Cobrança Médica')).toBeInTheDocument();
    expect(screen.getByText('Contabilidade')).toBeInTheDocument();
  });

  it('Médicos/Empresas/Emissão/Recebíveis/Extrato/DRE ficam sob "Cobrança Médica"', () => {
    renderSidebar();
    const secao = screen.getByText('Cobrança Médica').parentElement!;
    for (const label of ['Médicos', 'Empresas', 'Emissão', 'Recebíveis', 'Extrato', 'DRE']) {
      expect(secao).toHaveTextContent(label);
    }
  });

  it('Clientes Contábeis fica sob "Contabilidade", separado da Cobrança Médica', () => {
    renderSidebar();
    const secaoContabilidade = screen.getByText('Contabilidade').parentElement!;
    const secaoCobranca = screen.getByText('Cobrança Médica').parentElement!;
    expect(secaoContabilidade).toHaveTextContent('Clientes Contábeis');
    expect(secaoCobranca).not.toHaveTextContent('Clientes Contábeis');
  });

  it('Dashboard e Configurações continuam avulsos (fora das seções)', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Configurações/i })).toBeInTheDocument();
  });
});

describe('Sidebar — accordion das seções (item 3, polimento UX 2026-07-30)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clicar no título da seção recolhe o grupo (some o item de dentro)', () => {
    renderSidebar();
    const botaoSecao = screen.getByRole('button', { name: /Cobrança Médica/i });
    expect(botaoSecao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /Médicos/i })).toBeInTheDocument();

    fireEvent.click(botaoSecao);

    expect(botaoSecao).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /^Médicos$/i })).not.toBeInTheDocument();
  });
});

describe('Sidebar — colapso do modo desktop (item 1, polimento UX 2026-07-30)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mostra um controle para recolher/expandir o menu', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /Recolher menu/i })).toBeInTheDocument();
  });

  it('itens de navegação continuam com nome acessível depois de recolher', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /Recolher menu/i }));

    expect(screen.getByRole('button', { name: /Expandir menu/i })).toBeInTheDocument();
    // O link continua no DOM com o texto acessível (sr-only), mesmo com o rótulo visual oculto.
    expect(screen.getByRole('link', { name: /Médicos/i })).toBeInTheDocument();
  });
});
