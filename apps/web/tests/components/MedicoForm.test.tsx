// Teste de componente — o formulário bloqueia combinação inválida (PRD §8.2, architecture).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MedicoForm } from '../../src/components/medicos/MedicoForm';
import { empresasService } from '../../src/services/empresas';

// Story 10.4a: MedicoForm busca a lista de empresas para o vínculo de agrupamento — mocka o
// service (sem I/O) e sempre envolve com QueryClientProvider (useQuery exige o contexto).
vi.mock('../../src/services/empresas', () => ({
  empresasService: { listar: vi.fn() },
  empresaQueryKeys: { empresas: () => ['empresas'] as const },
}));

// `vi.restoreAllMocks()` (usado no describe de cobrança) reseta a implementação de vi.fn() —
// reaplica a cada teste para o useQuery de empresas nunca resolver undefined.
beforeEach(() => {
  vi.mocked(empresasService.listar).mockResolvedValue([]);
});

function renderForm(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('MedicoForm', () => {
  it('bloqueia salvar quando a combinação é inválida (nenhum Hapvida + sem outros)', () => {
    const onSubmit = vi.fn();
    renderForm(<MedicoForm onSubmit={onSubmit} />);

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
    renderForm(<MedicoForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /CPF \(11/i }), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nome completo/i }), {
      target: { value: 'Dr. Teste' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });
    // padrão: credenciado + não outros → TIPO 2
    expect(screen.getByText(/TIPO calculado/i)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar/i })).toBeEnabled();
  });

  // Story 7.3 (AC 1): médico novo exige a escolha explícita da empresa emissora.
  it('bloqueia salvar em médico NOVO até escolher a empresa emissora', () => {
    const onSubmit = vi.fn();
    renderForm(<MedicoForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /CPF \(11/i }), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nome completo/i }), {
      target: { value: 'Dr. Teste' },
    });

    expect(screen.getByText(/Escolha a empresa que emitirá os boletos/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'cavalcante_viana' },
    });
    expect(screen.getByRole('button', { name: /Salvar/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));
    expect(onSubmit.mock.calls[0]?.[0]?.contaEmissora).toBe('cavalcante_viana');
  });

  it('quando exigeMotivo é false, envia um motivo padrão em vez de string vazia (o servidor sempre exige motivo)', () => {
    const onSubmit = vi.fn();
    renderForm(<MedicoForm onSubmit={onSubmit} exigeMotivo={false} />);

    fireEvent.change(screen.getByRole('textbox', { name: /CPF \(11/i }), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nome completo/i }), {
      target: { value: 'Dr. Teste' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });
    expect(screen.queryByLabelText(/Motivo da alteração/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const motivoEnviado = onSubmit.mock.calls[0]?.[1];
    expect(motivoEnviado).toBeTruthy();
    expect(motivoEnviado.trim().length).toBeGreaterThan(0);
  });
});

// Auditoria 2026-09-02: o regex local do formulário (que decide se mostra "Mudança de data")
// tinha ficado pra trás do Engine — `usaRegra3x1` em contagem-producao.ts já incluía angiologista
// desde o GATE 2026-08-07, mas aqui o campo ficava escondido e o cadastro caía sempre em 'nao'.
describe('MedicoForm — campo "Mudança de data" segue o mesmo critério 3x1 do Engine', () => {
  function preencherMinimo() {
    fireEvent.change(screen.getByRole('textbox', { name: /CPF \(11/i }), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nome completo/i }), {
      target: { value: 'Dr. Teste' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Empresa emissora/i }), {
      target: { value: 'mc' },
    });
  }

  it.each(['Pediatra', 'Urologista', 'Ginecologista', 'Ortopedista', 'Angiologista'])(
    'especialidade "%s" (regra 3x1) exibe o campo',
    (especialidade) => {
      renderForm(<MedicoForm onSubmit={vi.fn()} />);
      preencherMinimo();
      fireEvent.change(screen.getByRole('textbox', { name: /Especialidade/i }), {
        target: { value: especialidade },
      });

      expect(screen.getByRole('combobox', { name: /Mudança de data/i })).toBeInTheDocument();
    },
  );

  it('especialidade sem regra 3x1 continua escondendo o campo e envia modoMudancaData "nao"', () => {
    const onSubmit = vi.fn();
    renderForm(<MedicoForm onSubmit={onSubmit} />);
    preencherMinimo();
    fireEvent.change(screen.getByRole('textbox', { name: /Especialidade/i }), {
      target: { value: 'Cirurgia Geral' },
    });

    expect(screen.queryByRole('combobox', { name: /Mudança de data/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));
    expect(onSubmit.mock.calls[0]?.[0]?.modoMudancaData).toBe('nao');
  });

  it('angiologista com "Muda data" selecionado PRESERVA a escolha no payload (antes era forçada a "nao")', () => {
    const onSubmit = vi.fn();
    renderForm(<MedicoForm onSubmit={onSubmit} />);
    preencherMinimo();
    fireEvent.change(screen.getByRole('textbox', { name: /Especialidade/i }), {
      target: { value: 'Angiologista' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Mudança de data/i }), {
      target: { value: 'sim' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));
    expect(onSubmit.mock.calls[0]?.[0]?.modoMudancaData).toBe('sim');
  });
});

describe('MedicoForm — seção de cobrança (Story 3.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderiza a seção de dados de cobrança', () => {
    renderForm(<MedicoForm onSubmit={vi.fn()} />);
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

    renderForm(<MedicoForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /^CEP/i }), {
      target: { value: '60000000' },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('https://viacep.com.br/ws/60000000/json/');
    });
    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: /Logradouro/i }) as HTMLInputElement).value).toBe('Rua das Flores');
    });
    expect((screen.getByRole('textbox', { name: /Cidade/i }) as HTMLInputElement).value).toBe('Fortaleza');
    expect((screen.getByRole('combobox', { name: /^UF/i }) as HTMLSelectElement).value).toBe('CE');
  });
});
