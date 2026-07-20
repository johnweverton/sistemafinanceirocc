// Teste de componente — EmpresaForm (Story 10.4a). Mesmo padrão de MedicoForm.test.tsx.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmpresaForm } from '../../src/components/empresas/EmpresaForm';

describe('EmpresaForm', () => {
  it('bloqueia salvar até escolher a empresa emissora e preencher o nome', () => {
    const onSubmit = vi.fn();
    render(<EmpresaForm onSubmit={onSubmit} />);

    expect(screen.getByRole('button', { name: /Salvar empresa/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: /Nome da empresa/i }), {
      target: { value: 'MEDISA' },
    });
    expect(screen.getByRole('button', { name: /Salvar empresa/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });
    expect(screen.getByRole('button', { name: /Salvar empresa/i })).toBeEnabled();
  });

  it('envia o payload com nome e contaEmissora ao salvar', () => {
    const onSubmit = vi.fn();
    render(<EmpresaForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /Nome da empresa/i }), {
      target: { value: 'MEDISA' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'cavalcante_viana' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar empresa/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ nome: 'MEDISA', contaEmissora: 'cavalcante_viana' });
  });

  it('regra de preço: "Configurar" abre os campos; por_guia exige taxa', () => {
    const onSubmit = vi.fn();
    render(<EmpresaForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /Nome da empresa/i }), {
      target: { value: 'MEDISA' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Configurar/i }));
    expect(screen.getByRole('button', { name: /Salvar empresa/i })).toBeDisabled();
    expect(screen.getByText(/Preencha todos os campos da regra de preço/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Taxa por guia/i }), {
      target: { value: '6.41' },
    });
    expect(screen.getByRole('button', { name: /Salvar empresa/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Salvar empresa/i }));
    expect(onSubmit.mock.calls[0]?.[0]?.regraPreco).toMatchObject({ forma: 'por_guia', taxa: 6.41 });
  });

  it('renderiza pré-preenchido a partir de uma empresa existente', () => {
    render(
      <EmpresaForm
        inicial={{
          id: 'emp-1',
          nome: 'MEDISA',
          cobranca: null,
          contaEmissora: 'mc',
          condicoes: null,
          regraPreco: { forma: 'por_guia', base: null, limiar: null, taxa: 6.41, valorFixo: null },
          ativo: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        }}
        exigeMotivo
        onSubmit={vi.fn()}
      />,
    );
    expect((screen.getByRole('textbox', { name: /Nome da empresa/i }) as HTMLInputElement).value).toBe('MEDISA');
    expect((screen.getByRole('spinbutton', { name: /Taxa por guia/i }) as HTMLInputElement).value).toBe('6.41');
  });
});
