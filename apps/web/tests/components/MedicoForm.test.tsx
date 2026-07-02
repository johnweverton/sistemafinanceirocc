// Teste de componente — o formulário bloqueia combinação inválida (PRD §8.2, architecture).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MedicoForm } from '../../src/components/medicos/MedicoForm';

describe('MedicoForm', () => {
  it('bloqueia salvar quando a combinação é inválida (nenhum Hapvida + sem outros)', () => {
    const onSubmit = vi.fn();
    render(<MedicoForm onSubmit={onSubmit} />);

    // Preenche CPF e nome válidos para isolar a regra de combinação.
    fireEvent.change(screen.getByRole('textbox', { name: /CPF \(11/i }), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nome completo/i }), {
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

    fireEvent.change(screen.getByRole('textbox', { name: /CPF \(11/i }), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nome completo/i }), {
      target: { value: 'Dr. Teste' },
    });
    // padrão: credenciado + não outros → TIPO 2
    expect(screen.getByText(/TIPO calculado/i)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar/i })).toBeEnabled();
  });
});

describe('MedicoForm — seção de cobrança (Story 3.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderiza a seção de dados de cobrança', () => {
    render(<MedicoForm onSubmit={vi.fn()} />);
    expect(screen.getByText(/Dados de cobrança/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Tipo de pagador/i })).toBeInTheDocument();
  });

  it('autofill via ViaCEP preenche logradouro/bairro/cidade/UF ao digitar o CEP', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        logradouro: 'Rua das Flores',
        bairro: 'Centro',
        localidade: 'Fortaleza',
        uf: 'CE',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MedicoForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /^CEP$/i }), {
      target: { value: '60000000' },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('https://viacep.com.br/ws/60000000/json/');
    });
    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: /Logradouro/i }) as HTMLInputElement).value).toBe('Rua das Flores');
    });
    expect((screen.getByRole('textbox', { name: /Cidade/i }) as HTMLInputElement).value).toBe('Fortaleza');
    expect((screen.getByRole('combobox', { name: /^UF$/i }) as HTMLSelectElement).value).toBe('CE');
  });
});
