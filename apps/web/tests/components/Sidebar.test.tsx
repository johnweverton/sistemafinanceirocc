// Teste de componente — Sidebar (reorganização UX 2026-07-24): agrupamento por seção separando
// Cobrança Médica de Contabilidade no menu lateral (feedback do dono).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('../../src/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { Sidebar } from '../../src/components/layout/Sidebar';

describe('Sidebar — agrupamento por seção (2026-07-24)', () => {
  it('mostra os rótulos de seção "Cobrança Médica" e "Contabilidade"', () => {
    render(<Sidebar />);
    expect(screen.getByText('Cobrança Médica')).toBeInTheDocument();
    expect(screen.getByText('Contabilidade')).toBeInTheDocument();
  });

  it('Médicos/Empresas/Execuções/Recebíveis/Extrato/DRE ficam sob "Cobrança Médica"', () => {
    render(<Sidebar />);
    const secao = screen.getByText('Cobrança Médica').parentElement!;
    for (const label of ['Médicos', 'Empresas', 'Execuções', 'Recebíveis', 'Extrato', 'DRE']) {
      expect(secao).toHaveTextContent(label);
    }
  });

  it('Clientes Contábeis fica sob "Contabilidade", separado da Cobrança Médica', () => {
    render(<Sidebar />);
    const secaoContabilidade = screen.getByText('Contabilidade').parentElement!;
    const secaoCobranca = screen.getByText('Cobrança Médica').parentElement!;
    expect(secaoContabilidade).toHaveTextContent('Clientes Contábeis');
    expect(secaoCobranca).not.toHaveTextContent('Clientes Contábeis');
  });

  it('Dashboard e Configurações continuam avulsos (fora das seções)', () => {
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Configurações/i })).toBeInTheDocument();
  });
});
