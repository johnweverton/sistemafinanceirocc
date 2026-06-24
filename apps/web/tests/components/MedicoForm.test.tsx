// Teste de componente — o formulário bloqueia combinação inválida (PRD §8.2, architecture).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MedicoForm } from '../../src/components/medicos/MedicoForm';

describe('MedicoForm', () => {
  it('bloqueia salvar quando a combinação é inválida (nenhum Hapvida + sem outros)', () => {
    const onSubmit = vi.fn();
    render(<MedicoForm onSubmit={onSubmit} />);

    // Preenche CPF e nome válidos para isolar a regra de combinação.
    fireEvent.change(screen.getByRole('textbox', { name: /CPF/i }), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nome/i }), {
      target: { value: 'Dr. Teste' },
    });

    // Combinação inválida: status nenhum + não faz outros hospitais.
    fireEvent.change(screen.getByRole('combobox', { name: /Status Hapvida/i }), {
      target: { value: 'nenhum' },
    });

    expect(screen.getByText(/Combinação inválida/i)).toBeInTheDocument();
    const botao = screen.getByRole('button', { name: /Salvar/i });
    expect(botao).toBeDisabled();
  });

  it('mostra o TIPO calculado para combinação válida e habilita salvar', () => {
    const onSubmit = vi.fn();
    render(<MedicoForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /CPF/i }), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nome/i }), {
      target: { value: 'Dr. Teste' },
    });
    // padrão: credenciado + não outros → TIPO 2
    expect(screen.getByText(/TIPO calculado/i)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar/i })).toBeEnabled();
  });
});
