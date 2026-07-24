// Teste de componente — ClienteContabilidadeForm (Story 11.1). Mesmo padrão de EmpresaForm.test.tsx.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClienteContabilidadeForm } from '../../src/components/clientes-contabilidade/ClienteContabilidadeForm';

describe('ClienteContabilidadeForm', () => {
  it('bloqueia salvar até escolher a empresa emissora e preencher o nome (regra faixa_faturamento vem pré-preenchida)', () => {
    const onSubmit = vi.fn();
    render(<ClienteContabilidadeForm onSubmit={onSubmit} />);

    expect(screen.getByRole('button', { name: /Salvar cliente/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: /Nome do cliente/i }), {
      target: { value: 'Padaria Bom Pão Ltda' },
    });
    expect(screen.getByRole('button', { name: /Salvar cliente/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });
    expect(screen.getByRole('button', { name: /Salvar cliente/i })).toBeEnabled();
  });

  it('envia o payload com regra faixa_faturamento por padrão (Simples Nacional)', () => {
    const onSubmit = vi.fn();
    render(<ClienteContabilidadeForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /Nome do cliente/i }), {
      target: { value: 'Padaria Bom Pão Ltda' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar cliente/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ nome: 'Padaria Bom Pão Ltda', regimeTributario: 'simples_nacional', modoCobranca: 'faixa_faturamento' });
    expect(payload.regraPreco).toMatchObject({ forma: 'faixa_faturamento', limiar: 5000, valorAbaixoLimiar: 250, valorAcimaLimiar: 480.56 });
  });

  it('trocar para modo "fixo" exige valor fixo antes de habilitar salvar', () => {
    const onSubmit = vi.fn();
    render(<ClienteContabilidadeForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /Nome do cliente/i }), {
      target: { value: 'Clínica X' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Modo de cobrança/i }), {
      target: { value: 'fixo' },
    });
    expect(screen.getByRole('button', { name: /Salvar cliente/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Valor fixo mensal/i }), {
      target: { value: '1200' },
    });
    expect(screen.getByRole('button', { name: /Salvar cliente/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Salvar cliente/i }));
    expect(onSubmit.mock.calls[0]?.[0]?.regraPreco).toMatchObject({ forma: 'fixo', valorFixo: 1200 });
  });

  it('adicional semestral: ativar exige valor, intervalo e competência antes de habilitar salvar', () => {
    const onSubmit = vi.fn();
    render(<ClienteContabilidadeForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /Nome do cliente/i }), {
      target: { value: 'Vital Soluções' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Cliente tem/i }));
    expect(screen.getByRole('button', { name: /Salvar cliente/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Valor do adicional/i }), {
      target: { value: '15000' },
    });
    fireEvent.change(screen.getByLabelText(/Competência base/i), { target: { value: '2026-01' } });
    expect(screen.getByRole('button', { name: /Salvar cliente/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Salvar cliente/i }));
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.adicionalAtivo).toBe(true);
    expect(payload.adicionalValor).toBe(15000);
    expect(payload.adicionalIntervaloMeses).toBe(6);
    expect(payload.adicionalCompetenciaBase).toBe('2026-01');
  });

  it('renderiza pré-preenchido a partir de um cliente existente', () => {
    render(
      <ClienteContabilidadeForm
        inicial={{
          id: 'cc-1',
          nome: 'Padaria Bom Pão Ltda',
          regimeTributario: 'simples_nacional',
          modoCobranca: 'faixa_faturamento',
          cobranca: null,
          contaEmissora: 'mc',
          condicoes: null,
          regraPreco: {
            forma: 'faixa_faturamento',
            base: null,
            limiar: 5000,
            taxa: null,
            valorFixo: null,
            valorAbaixoLimiar: 250,
            valorAcimaLimiar: 480.56,
          },
          adicionalAtivo: false,
          adicionalValor: null,
          adicionalIntervaloMeses: null,
          adicionalCompetenciaBase: null,
          ativo: true,
          createdAt: '2026-07-24T00:00:00Z',
          updatedAt: '2026-07-24T00:00:00Z',
        }}
        exigeMotivo
        onSubmit={vi.fn()}
      />,
    );
    expect((screen.getByRole('textbox', { name: /Nome do cliente/i }) as HTMLInputElement).value).toBe(
      'Padaria Bom Pão Ltda',
    );
    expect((screen.getByRole('spinbutton', { name: /Limite de faturamento/i }) as HTMLInputElement).value).toBe(
      '5000',
    );
  });
});
