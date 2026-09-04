// Teste do modo "Por empresa" de NovaExecucao.tsx (Story 10.4c AC2) — dispara execução agregada
// por empresa (MEDISA), exigindo produção selecionada para TODOS os médicos vinculados antes de
// habilitar o botão (sem rateio implícito: se falta produção de um médico, não dispara).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockApoio = vi.fn();
const mockDisparar = vi.fn();
const mockMedicosComBoleto = vi.fn();
const mockPreviewGuiasManuais = vi.fn();
const mockLotes = vi.fn(async (..._args: unknown[]): Promise<{ lotes: { id: string; nome: string }[] }> => ({
  lotes: [],
}));
vi.mock('../../src/services/execucoes', () => ({
  execucoesService: {
    apoio: (...a: unknown[]) => mockApoio(...a),
    disparar: (...a: unknown[]) => mockDisparar(...a),
    medicosComBoleto: (...a: unknown[]) => mockMedicosComBoleto(...a),
    lotes: (...a: unknown[]) => mockLotes(...a),
    previewGuiasManuais: (...a: unknown[]) => mockPreviewGuiasManuais(...a),
  },
  execucaoQueryKeys: {
    apoio: () => ['execucoes', 'apoio'],
    execucoes: () => ['execucoes'],
    medicosComBoleto: (c: string) => ['execucoes', 'medicos-com-boleto', c],
    lotes: (p: string) => ['execucoes', 'lotes', p],
  },
}));

const mockListarEmpresas = vi.fn();
vi.mock('../../src/services/empresas', () => ({
  empresasService: { listar: (...a: unknown[]) => mockListarEmpresas(...a) },
  empresaQueryKeys: { empresas: () => ['empresas'] },
}));

vi.mock('../../src/hooks/useExecucaoRealtime', () => ({
  useExecucaoRealtime: () => ({ execucao: null }),
}));

import { NovaExecucao } from '../../src/components/execucoes/NovaExecucao';

function renderComProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <NovaExecucao />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const medicoAlfa = {
  id: 'm1', nome: 'Dr. Alfa', ativo: true, necessitaConfiguracao: false,
  externalId: 'ext-alfa', empresaGrupoId: 'empresa-1',
};
const medicoBeta = {
  id: 'm2', nome: 'Dr. Beta', ativo: true, necessitaConfiguracao: false,
  externalId: 'ext-beta', empresaGrupoId: 'empresa-1',
};
const medicoAvulso = {
  id: 'm3', nome: 'Dr. Avulso', ativo: true, necessitaConfiguracao: false,
  externalId: 'ext-avulso', empresaGrupoId: null,
};

const apoioFixture = {
  medicos: [medicoAlfa, medicoBeta, medicoAvulso],
  clientesOrigem: [
    { id: 'ext-alfa', nome: 'Cliente Alfa', producoes: [{ id: 'p-alfa-1', nome: 'Guias 2026-06' }] },
    { id: 'ext-beta', nome: 'Cliente Beta', producoes: [{ id: 'p-beta-1', nome: 'Guias 2026-06' }] },
    { id: 'ext-avulso', nome: 'Cliente Avulso', producoes: [] },
  ],
};

const empresaFixture = { id: 'empresa-1', nome: 'MEDISA', ativo: true };

async function entrarNoModoEmpresa() {
  fireEvent.click(await screen.findByRole('button', { name: 'Por empresa' }));
}

describe('NovaExecucao — modo "Por empresa" (Story 10.4c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioFixture);
    mockListarEmpresas.mockResolvedValue([empresaFixture]);
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: [] });
  });

  it('lista só os médicos vinculados à empresa selecionada', async () => {
    renderComProviders();
    await entrarNoModoEmpresa();

    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'empresa-1' } });

    await screen.findByText('Dr. Alfa');
    expect(screen.getByText('Dr. Beta')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Avulso')).not.toBeInTheDocument();
  });

  it('mantém o botão desabilitado até TODOS os médicos vinculados terem produção selecionada', async () => {
    renderComProviders();
    await entrarNoModoEmpresa();
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'empresa-1' } });
    await screen.findByText('Dr. Alfa');

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-06' } });
    const botao = screen.getByRole('button', { name: /Processar empresa/ });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Produção de guias cardíacas de Dr. Alfa'), {
      target: { value: 'p-alfa-1' },
    });
    expect(botao).toHaveTextContent('Processar empresa (1/2 médicos)');
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Produção de guias cardíacas de Dr. Beta'), {
      target: { value: 'p-beta-1' },
    });
    expect(botao).toHaveTextContent('Processar empresa (2/2 médicos)');
    expect(botao).toBeEnabled();
  });

  it('dispara a execução com empresaId e as seleções de todos os médicos vinculados', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-empresa-1' });
    renderComProviders();
    await entrarNoModoEmpresa();
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'empresa-1' } });
    await screen.findByText('Dr. Alfa');

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-06' } });
    fireEvent.change(screen.getByLabelText('Produção de guias cardíacas de Dr. Alfa'), {
      target: { value: 'p-alfa-1' },
    });
    fireEvent.change(screen.getByLabelText('Produção de guias cardíacas de Dr. Beta'), {
      target: { value: 'p-beta-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Processar empresa/ }));

    await waitFor(() =>
      expect(mockDisparar).toHaveBeenCalledWith(
        '2026-06',
        expect.arrayContaining([
          expect.objectContaining({ medicoId: 'm1', producaoExternaId: 'p-alfa-1' }),
          expect.objectContaining({ medicoId: 'm2', producaoExternaId: 'p-beta-1' }),
        ]),
        'empresa-1',
      ),
    );
  });

  it('mostra mensagem quando a empresa selecionada não tem médicos vinculados', async () => {
    mockApoio.mockResolvedValue({ ...apoioFixture, medicos: [medicoAvulso] });
    renderComProviders();
    await entrarNoModoEmpresa();
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'empresa-1' } });

    await screen.findByText(/Nenhum médico vinculado a esta empresa/);
  });
});

// Achado real (2026-08-04, coordenadora financeira): emitir boleto individualmente pra alguns
// médicos e depois rodar o mesmo mês em lote não detectava que esses médicos já tinham boleto,
// arriscando duplicar. /api/execucoes/medicos-com-boleto fecha essa lacuna.
describe('NovaExecucao — médico já tem boleto na competência (achado 2026-08-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioFixture);
    mockListarEmpresas.mockResolvedValue([empresaFixture]);
  });

  it('modo "Por competência": exclui o médico já emitido de "Prontos para processar" e lista em "Já emitido"', async () => {
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: ['m1'] }); // Dr. Alfa já emitido
    renderComProviders();

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-06' } });

    await screen.findByText('Já emitido nesta competência (1)');
    // Dr. Alfa some da lista de seleção (pronto pra processar)...
    const prontos = screen.getByText(/Prontos para processar/).closest('div')!;
    expect(prontos).not.toHaveTextContent('Dr. Alfa');
    // ...e aparece só no grupo de já emitidos.
    expect(screen.getByText('Já emitido nesta competência (1)').closest('div')!).toHaveTextContent('Dr. Alfa');
    // Dr. Beta (sem boleto) continua elegível normalmente.
    expect(screen.getByText('Dr. Beta')).toBeInTheDocument();
  });

  it('modo "Por médico": avisa e desabilita o botão quando o médico selecionado já tem boleto na competência', async () => {
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: ['m1'] }); // Dr. Alfa já emitido
    renderComProviders();
    fireEvent.click(await screen.findByRole('button', { name: 'Por médico' }));

    fireEvent.change(screen.getByLabelText('Médico'), { target: { value: 'm1' } });
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-06' } });

    await screen.findByText(/já tem boleto emitido para a competência 2026-06/);
    expect(screen.getByRole('button', { name: 'Processar médico' })).toBeDisabled();
  });
});

// Achado real 2026-08-21 (caso do Humberto Bia): a produção mensal do pediatra pode ter a MESMA
// estrutura de sub-lotes do Angiologista (fin-lotes) — sub-lotes de guia (1Q/2Q) MAIS um sub-lote
// de consultas ambulatoriais, tudo dentro da mesma produção mensal (ex.: "JULHO - 2026"). Desde o
// achado 2026-09-03, um sub-lote com "CONSULTA" no nome vira Consultas AUTOMATICAMENTE (sem
// clique manual) e todos os sub-lotes com esse nome são somados; sem esse nome, cai no dropdown
// manual de sempre (fallback, sem regressão).
describe('NovaExecucao — modo "Por médico": sub-lotes de consulta de pediatria (achado 2026-08-21, automático 2026-09-03)', () => {
  const medicoHumberto = {
    id: 'm-humberto', nome: 'Dr. Humberto', ativo: true, necessitaConfiguracao: false,
    externalId: 'ext-humberto', especialidade: 'Pediatria',
  };
  const apoioPediatraFixture = {
    medicos: [medicoHumberto],
    clientesOrigem: [
      { id: 'ext-humberto', nome: 'Humberto', producoes: [{ id: 'p-julho', nome: 'JULHO - 2026' }] },
    ],
  };
  const subLotesJulho = [
    { id: 'lote-1q', nome: 'HUMBERTO 1Q' },
    { id: 'lote-2q', nome: 'HUMBERTO 2Q' },
    { id: 'lote-consultas', nome: 'HUMBERTO CONSULTAS DE JUNHO' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioPediatraFixture);
    mockListarEmpresas.mockResolvedValue([]);
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: [] });
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-julho' ? { lotes: subLotesJulho } : { lotes: [] },
    );
  });

  async function selecionarMedicoEProducao() {
    fireEvent.click(await screen.findByRole('button', { name: 'Por médico' }));
    fireEvent.change(screen.getByLabelText('Médico'), { target: { value: 'm-humberto' } });
    fireEvent.change(screen.getByLabelText('Produção'), { target: { value: 'p-julho' } });
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-julho'));
  }

  it('detecta o sub-lote de Consultas automaticamente pelo nome, sem exigir clique manual', async () => {
    renderComProviders();
    await selecionarMedicoEProducao();

    await screen.findByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome');
    expect(screen.getByText('HUMBERTO CONSULTAS DE JUNHO')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Produção de consultas/)).not.toBeInTheDocument();
  });

  it('dispara automaticamente com producaoExternaId nulo e os OUTROS sub-lotes como guia principal, sem clique manual', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-1' });
    renderComProviders();
    await selecionarMedicoEProducao();
    await screen.findByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome');

    fireEvent.click(screen.getByRole('button', { name: 'Processar médico' }));

    await waitFor(() =>
      expect(mockDisparar).toHaveBeenCalledWith(
        '2026-07',
        [
          expect.objectContaining({
            medicoId: 'm-humberto',
            producaoExternaId: null,
            producaoNome: null,
            producaoConsultasLoteExternaIds: ['lote-consultas'],
            producaoConsultasLoteNomes: ['HUMBERTO CONSULTAS DE JUNHO'],
            producaoGuiasLoteExternaIds: ['lote-1q', 'lote-2q'],
            producaoGuiasLoteNomes: ['HUMBERTO 1Q', 'HUMBERTO 2Q'],
          }),
        ],
        undefined,
      ),
    );
  });

  it('soma MAIS DE UM sub-lote de Consultas quando mais de um nome bate (ex.: 1Q e 2Q de consultas)', async () => {
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-julho'
        ? {
            lotes: [
              { id: 'lote-1q', nome: 'HUMBERTO 1Q' },
              { id: 'lote-consultas-1q', nome: 'HUMBERTO CONSULTAS 1Q' },
              { id: 'lote-consultas-2q', nome: 'HUMBERTO CONSULTAS 2Q' },
            ],
          }
        : { lotes: [] },
    );
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-2' });
    renderComProviders();
    await selecionarMedicoEProducao();
    await screen.findByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome');

    fireEvent.click(screen.getByRole('button', { name: 'Processar médico' }));

    await waitFor(() =>
      expect(mockDisparar).toHaveBeenCalledWith(
        '2026-07',
        [
          expect.objectContaining({
            producaoConsultasLoteExternaIds: ['lote-consultas-1q', 'lote-consultas-2q'],
            producaoGuiasLoteExternaIds: ['lote-1q'],
          }),
        ],
        undefined,
      ),
    );
  });

  // Achado real 2026-09-04 (mesmo dia do achado do mês anterior): um colaborador colocou as
  // consultas de um mês no sub-lote de OUTRO mês por engano, e a classificação automática por
  // nome (sem ambiguidade possível) não tinha como saber disso — o operador precisa poder
  // desmarcar manualmente o sub-lote errado. Com o único sub-lote detectado desmarcado, a UI
  // reabre o seletor manual de fallback (mesmo usado quando nada bate com "CONSULTA" no nome).
  it('permite desmarcar um sub-lote de Consultas auto-detectado e reabre o seletor manual quando todos forem desmarcados', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-4' });
    renderComProviders();
    await selecionarMedicoEProducao();
    await screen.findByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome');

    const checkbox = screen.getByLabelText('HUMBERTO CONSULTAS DE JUNHO') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    // Com o único sub-lote detectado desmarcado, o dropdown manual de fallback reaparece.
    expect(await screen.findByLabelText(/Produção de consultas/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Processar médico' }));

    await waitFor(() =>
      expect(mockDisparar).toHaveBeenCalledWith(
        '2026-07',
        [
          expect.objectContaining({
            medicoId: 'm-humberto',
            producaoExternaId: 'p-julho',
            producaoNome: 'JULHO - 2026',
          }),
        ],
        undefined,
      ),
    );
    const payload = mockDisparar.mock.calls[0]![1]![0];
    expect(payload.producaoConsultasLoteExternaIds).toBeUndefined();
    expect(payload.producaoGuiasLoteExternaIds).toBeUndefined();
  });

  it('sem nenhum sub-lote com "CONSULTA" no nome, mantém o dropdown manual e o pacote completo sem regressão', async () => {
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-julho'
        ? {
            lotes: [
              { id: 'lote-1q', nome: 'HUMBERTO 1Q' },
              { id: 'lote-2q', nome: 'HUMBERTO 2Q' },
            ],
          }
        : { lotes: [] },
    );
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-3' });
    renderComProviders();
    await selecionarMedicoEProducao();

    expect(screen.queryByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome')).not.toBeInTheDocument();
    const select = screen.getByLabelText(/Produção de consultas/) as HTMLSelectElement;
    const opcoes = Array.from(select.options).map((o) => o.textContent);
    expect(opcoes).toEqual(expect.arrayContaining(['HUMBERTO 1Q', 'HUMBERTO 2Q']));

    fireEvent.click(screen.getByRole('button', { name: 'Processar médico' }));

    await waitFor(() =>
      expect(mockDisparar).toHaveBeenCalledWith(
        '2026-07',
        [expect.objectContaining({ medicoId: 'm-humberto', producaoExternaId: 'p-julho', producaoNome: 'JULHO - 2026' })],
        undefined,
      ),
    );
    const [, selecoesEnviadas] = mockDisparar.mock.calls[0]!;
    expect(selecoesEnviadas[0]).not.toHaveProperty('producaoConsultasLoteExternaIds');
    expect(selecoesEnviadas[0]).not.toHaveProperty('producaoGuiasLoteExternaIds');
  });

  it('trocar de Produção atualiza a classificação automática (evita sub-lote "fantasma" da produção anterior)', async () => {
    mockApoio.mockResolvedValue({
      medicos: [medicoHumberto],
      clientesOrigem: [
        {
          id: 'ext-humberto',
          nome: 'Humberto',
          producoes: [
            { id: 'p-julho', nome: 'JULHO - 2026' },
            { id: 'p-agosto', nome: 'AGOSTO - 2026' },
          ],
        },
      ],
    });
    mockLotes.mockImplementation(async (...args: unknown[]) => {
      const producaoId = args[0];
      if (producaoId === 'p-julho') return { lotes: subLotesJulho };
      if (producaoId === 'p-agosto') return { lotes: [{ id: 'lote-ago-1q', nome: 'HUMBERTO AGOSTO 1Q' }] };
      return { lotes: [] };
    });
    renderComProviders();
    await selecionarMedicoEProducao();
    await screen.findByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome');

    // Troca para a produção mensal de Agosto (sem sub-lote de consulta) — o bloco de
    // classificação automática de Julho não pode "vazar" pra cá.
    fireEvent.change(screen.getByLabelText('Produção'), { target: { value: 'p-agosto' } });

    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-agosto'));
    expect(screen.queryByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome')).not.toBeInTheDocument();
  });
});

// Achado 2026-09-04 (feedback do dono): a origem gera as guias de Consultas do Pediatra com 1 mês
// de atraso — o sub-lote de Consultas da competência de agosto fica dentro da produção mensal de
// JULHO, não da de agosto. A UI busca essa produção automaticamente (mesma heurística de nome/
// data do casamento principal) e soma os sub-lotes "CONSULTA" dela, sem exigir escolha manual.
describe('NovaExecucao — modo "Por médico": sub-lote de Consultas do mês ANTERIOR (achado 2026-09-04)', () => {
  const medicoIracema = {
    id: 'm-iracema', nome: 'Dra. Iracema', ativo: true, necessitaConfiguracao: false,
    externalId: 'ext-iracema', especialidade: 'Pediatria',
  };
  const apoioIracemaFixture = {
    medicos: [medicoIracema],
    clientesOrigem: [
      {
        id: 'ext-iracema',
        nome: 'Iracema',
        producoes: [
          { id: 'p-iracema-julho', nome: 'JULHO - 2026' },
          { id: 'p-iracema-agosto', nome: 'AGOSTO - 2026' },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioIracemaFixture);
    mockListarEmpresas.mockResolvedValue([]);
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: [] });
    mockLotes.mockImplementation(async (...args: unknown[]) => {
      const producaoId = args[0];
      if (producaoId === 'p-iracema-agosto') {
        return { lotes: [{ id: 'lote-ago-1q', nome: 'IRACEMA 1Q' }, { id: 'lote-ago-2q', nome: 'IRACEMA 2Q' }] };
      }
      if (producaoId === 'p-iracema-julho') {
        return { lotes: [{ id: 'lote-jul-consultas', nome: 'IRACEMA CONSULTAS DE JULHO' }] };
      }
      return { lotes: [] };
    });
  });

  async function selecionarAgostoComCompetenciaAgosto() {
    fireEvent.click(await screen.findByRole('button', { name: 'Por médico' }));
    fireEvent.change(screen.getByLabelText('Médico'), { target: { value: 'm-iracema' } });
    fireEvent.change(screen.getByLabelText('Produção'), { target: { value: 'p-iracema-agosto' } });
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-08' } });
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-iracema-agosto'));
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-iracema-julho'));
  }

  it('detecta o sub-lote de Consultas na produção de JULHO mesmo com "Produção" apontando para AGOSTO', async () => {
    renderComProviders();
    await selecionarAgostoComCompetenciaAgosto();

    await screen.findByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome');
    expect(screen.getByText('IRACEMA CONSULTAS DE JULHO')).toBeInTheDocument();
  });

  it('dispara com o sub-lote de Consultas de julho e TODOS os sub-lotes de agosto como guia principal (nada excluído)', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-iracema' });
    renderComProviders();
    await selecionarAgostoComCompetenciaAgosto();
    await screen.findByText('Sub-lote(s) de Consultas detectados automaticamente pelo nome');

    fireEvent.click(screen.getByRole('button', { name: 'Processar médico' }));

    await waitFor(() =>
      expect(mockDisparar).toHaveBeenCalledWith(
        '2026-08',
        [
          expect.objectContaining({
            medicoId: 'm-iracema',
            producaoExternaId: null,
            producaoNome: null,
            producaoConsultasLoteExternaIds: ['lote-jul-consultas'],
            producaoConsultasLoteNomes: ['IRACEMA CONSULTAS DE JULHO'],
            producaoGuiasLoteExternaIds: ['lote-ago-1q', 'lote-ago-2q'],
            producaoGuiasLoteNomes: ['IRACEMA 1Q', 'IRACEMA 2Q'],
          }),
        ],
        undefined,
      ),
    );
  });
});

// Achado real 2026-09-03 (feedback do dono): médico VH que faz Imobilizações tem a produção
// mensal INTEIRA dividida em vários sub-lotes por dia/período, já nomeados com a classe
// ("CIRURGIAS - 05/08", "IMOBILIZAÇÕES 11/08 AO 12/08", ...) — a UI classifica pelo nome e soma
// automaticamente, sem exigir marcar um por um (migration 0059).
describe('NovaExecucao — modo "Por médico": sub-lotes de Cirurgia/Imobilizações do padrão VH (achado 2026-09-03)', () => {
  const medicoVH = {
    id: 'm-vh', nome: 'Dr. VH Imobilizações', ativo: true, necessitaConfiguracao: false,
    externalId: 'ext-vh', especialidade: 'Ortopedia', fazImobilizacoes: true,
  };
  const apoioVHFixture = {
    medicos: [medicoVH],
    clientesOrigem: [{ id: 'ext-vh', nome: 'VH', producoes: [{ id: 'p-agosto', nome: 'AGOSTO - 2026' }] }],
  };
  const subLotesAgosto = [
    { id: 'lote-cir-05', nome: 'CIRURGIAS - 05/08' },
    { id: 'lote-imob-05', nome: 'IMOBILIZAÇÕES - 05/08' },
    { id: 'lote-cir-11-12', nome: 'CIRURGIAS 11/08 AO 12/08' },
    { id: 'lote-imob-11-12', nome: 'IMOBILIZAÇÕES 11/08 AO 12/08' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioVHFixture);
    mockListarEmpresas.mockResolvedValue([]);
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: [] });
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-agosto' ? { lotes: subLotesAgosto } : { lotes: [] },
    );
  });

  async function selecionarMedicoEProducao() {
    fireEvent.click(await screen.findByRole('button', { name: 'Por médico' }));
    fireEvent.change(screen.getByLabelText('Médico'), { target: { value: 'm-vh' } });
    fireEvent.change(screen.getByLabelText('Produção'), { target: { value: 'p-agosto' } });
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-08' } });
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-agosto'));
  }

  it('classifica os sub-lotes automaticamente pelo nome e substitui o dropdown manual', async () => {
    renderComProviders();
    await selecionarMedicoEProducao();

    await screen.findByText('Sub-lotes classificados automaticamente pelo nome');
    expect(screen.queryByLabelText('Lote de Imobilizações')).not.toBeInTheDocument();
  });

  it('dispara com producaoExternaId nulo, somando Cirurgia como guia principal e Imobilizações à parte', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-vh' });
    renderComProviders();
    await selecionarMedicoEProducao();
    await screen.findByText('Sub-lotes classificados automaticamente pelo nome');

    fireEvent.click(screen.getByRole('button', { name: 'Processar médico' }));

    await waitFor(() =>
      expect(mockDisparar).toHaveBeenCalledWith(
        '2026-08',
        [
          expect.objectContaining({
            medicoId: 'm-vh',
            producaoExternaId: null,
            producaoNome: null,
            producaoGuiasLoteExternaIds: ['lote-cir-05', 'lote-cir-11-12'],
            producaoGuiasLoteNomes: ['CIRURGIAS - 05/08', 'CIRURGIAS 11/08 AO 12/08'],
            producaoImobilizacoesLoteExternaIds: ['lote-imob-05', 'lote-imob-11-12'],
            producaoImobilizacoesLoteNomes: ['IMOBILIZAÇÕES - 05/08', 'IMOBILIZAÇÕES 11/08 AO 12/08'],
          }),
        ],
        undefined,
      ),
    );
  });

  it('bloqueia o disparo quando um sub-lote tem nome não reconhecido, até classificar manualmente', async () => {
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-agosto'
        ? { lotes: [...subLotesAgosto, { id: 'lote-estranho', nome: 'PARECER 15/08' }] }
        : { lotes: [] },
    );
    renderComProviders();
    await selecionarMedicoEProducao();

    await screen.findByText(/nome não reconhecido/);
    expect(screen.getByRole('button', { name: 'Processar médico' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Classe do sub-lote PARECER 15/08'), {
      target: { value: 'cirurgia' },
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Processar médico' })).toBeEnabled());
  });

  it('sem nenhum sub-lote de Cirurgia (padrão antigo: só Imobilizações separada), mantém o dropdown manual sem regressão', async () => {
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-agosto' ? { lotes: [{ id: 'lote-imob-unico', nome: '1º QUINZENA IMOBILIZAÇÕES' }] } : { lotes: [] },
    );
    renderComProviders();
    await selecionarMedicoEProducao();

    expect(screen.getByLabelText('Lote de Imobilizações')).toBeInTheDocument();
    expect(screen.queryByText(/nome não reconhecido/)).not.toBeInTheDocument();
  });
});

// Achado 2026-09-03 (feedback do dono): os 3 checkboxes manuais de Cateter/Fístula/Angiografia do
// Angiologista (cada um listando TODOS os sub-lotes, exigindo que o operador soubesse identificar
// de olho qual pertencia a qual categoria) viram classificação automática pelo nome — Cateter/
// Fístula/Carta de Rede usam palavra literal, Angiografia usa "PACOTE" (confirmado pelo dono).
describe('NovaExecucao — modo "Por médico": sub-lotes de Cateter/Fístula/Angiografia/Carta de Rede do Angiologista (achado 2026-09-03)', () => {
  const medicoSamanta = {
    id: 'm-samanta', nome: 'Dra. Samanta', ativo: true, necessitaConfiguracao: false,
    externalId: 'ext-samanta', especialidade: 'Angiologia',
  };
  const apoioAngiologistaFixture = {
    medicos: [medicoSamanta],
    clientesOrigem: [{ id: 'ext-samanta', nome: 'Samanta', producoes: [{ id: 'p-julho', nome: 'JULHO - 2026' }] }],
  };
  const subLotesJulho = [
    { id: 'lote-cateter-1q', nome: 'SAMANTA CATETER 1Q' },
    { id: 'lote-fistula-1q', nome: 'SAMANTA FISTULA 1Q' },
    { id: 'lote-pacote-1q', nome: 'SAMANTA PACOTE 25K 1Q' },
    { id: 'lote-carta-rede', nome: 'SAMANTA CARTA DE REDE' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioAngiologistaFixture);
    mockListarEmpresas.mockResolvedValue([]);
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: [] });
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-julho' ? { lotes: subLotesJulho } : { lotes: [] },
    );
  });

  async function selecionarMedicoEProducaoMensal() {
    fireEvent.click(await screen.findByRole('button', { name: 'Por médico' }));
    fireEvent.change(screen.getByLabelText('Médico'), { target: { value: 'm-samanta' } });
    fireEvent.change(screen.getByLabelText('Produção mensal'), { target: { value: 'p-julho' } });
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-julho'));
  }

  it('classifica os 4 sub-lotes automaticamente pelo nome, sem checkboxes manuais', async () => {
    renderComProviders();
    await selecionarMedicoEProducaoMensal();

    await screen.findByText('Sub-lotes classificados automaticamente pelo nome');
    expect(screen.queryByLabelText(/producao-cateter-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/marque mais de um se houver quinzenas/)).not.toBeInTheDocument();
  });

  it('dispara com Cateter/Fístula/Angiografia/Carta de Rede corretos, sem clique manual em checkbox', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-angio-1' });
    renderComProviders();
    await selecionarMedicoEProducaoMensal();
    await screen.findByText('Sub-lotes classificados automaticamente pelo nome');

    fireEvent.change(screen.getByLabelText(/Carta de Rede — guias/), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Processar médico' }));

    await waitFor(() =>
      expect(mockDisparar).toHaveBeenCalledWith(
        '2026-07',
        [
          expect.objectContaining({
            medicoId: 'm-samanta',
            producaoCateterExternaIds: ['lote-cateter-1q'],
            producaoCateterNomes: ['SAMANTA CATETER 1Q'],
            producaoFistulaExternaIds: ['lote-fistula-1q'],
            producaoFistulaNomes: ['SAMANTA FISTULA 1Q'],
            producaoAngiografiaExternaIds: ['lote-pacote-1q'],
            producaoAngiografiaNomes: ['SAMANTA PACOTE 25K 1Q'],
            producaoCartaRedeExternaId: 'lote-carta-rede',
            producaoCartaRedeNome: 'SAMANTA CARTA DE REDE',
            cartaRedeGuias: 5,
          }),
        ],
        undefined,
      ),
    );
  });

  it('bloqueia o disparo quando um sub-lote tem nome não reconhecido, até classificar manualmente', async () => {
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-julho' ? { lotes: [...subLotesJulho, { id: 'lote-estranho', nome: 'SAMANTA EXTRA' }] } : { lotes: [] },
    );
    renderComProviders();
    await selecionarMedicoEProducaoMensal();

    await screen.findByText(/nome não reconhecido/);
    expect(screen.getByRole('button', { name: 'Processar médico' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Classe do sub-lote SAMANTA EXTRA'), {
      target: { value: 'cateter' },
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Processar médico' })).toBeEnabled());
  });
});

// Achado real 2026-09-03 (Dr. Caio Torres, disparo em lote de 66 médicos): a classificação
// automática de sub-lotes só funcionava no modo "Por médico" — no modo "Por competência" (o fluxo
// real do dia a dia), TODO médico Angiologista saía com 0 guias (nenhum lote de Cateter/Fístula/
// Angiografia era buscado), e VH/Imobilizações e Pediatra-com-sub-lote-de-Consulta cobravam a
// produção completa errada. Este describe cobre a FASE 2/3 do `selecoesInfo` (busca de sub-lotes
// em paralelo via useQueries + classificação automática) no modo em lote.
describe('NovaExecucao — modo "Por competência": sub-lotes automáticos (achado 2026-09-03)', () => {
  const medicoSamanta = {
    id: 'm-samanta', nome: 'Dra. Samanta', ativo: true, necessitaConfiguracao: false,
    externalId: 'ext-samanta', especialidade: 'Angiologia',
  };
  const medicoHumbertoBulk = {
    id: 'm-humberto-bulk', nome: 'Dr. Humberto Bulk', ativo: true, necessitaConfiguracao: false,
    externalId: 'ext-humberto-bulk', especialidade: 'Pediatria',
  };
  const medicoCamillaBulk = {
    id: 'm-camilla-bulk', nome: 'Dra. Camilla Bulk', ativo: true, necessitaConfiguracao: false,
    externalId: 'ext-camilla-bulk', especialidade: 'Ortopedia', fazImobilizacoes: true,
  };
  const apoioFixtureBulk = {
    medicos: [medicoSamanta, medicoHumbertoBulk, medicoCamillaBulk],
    clientesOrigem: [
      { id: 'ext-samanta', nome: 'Samanta', producoes: [{ id: 'p-samanta', nome: 'JULHO - 2026' }] },
      { id: 'ext-humberto-bulk', nome: 'Humberto', producoes: [{ id: 'p-humberto-bulk', nome: 'JULHO - 2026' }] },
      { id: 'ext-camilla-bulk', nome: 'Camilla', producoes: [{ id: 'p-camilla-bulk', nome: 'JULHO - 2026' }] },
    ],
  };

  function mockLotesPadrao() {
    mockLotes.mockImplementation(async (...args: unknown[]) => {
      const producaoId = args[0];
      if (producaoId === 'p-samanta') {
        return {
          lotes: [
            { id: 'lote-cateter', nome: 'SAMANTA CATETER 1Q' },
            { id: 'lote-fistula', nome: 'SAMANTA FISTULA 1Q' },
            { id: 'lote-pacote', nome: 'SAMANTA PACOTE 25K 1Q' },
            { id: 'lote-carta', nome: 'SAMANTA CARTA DE REDE' },
          ],
        };
      }
      if (producaoId === 'p-humberto-bulk') {
        return {
          lotes: [
            { id: 'lote-1q', nome: 'HUMBERTO 1Q' },
            { id: 'lote-consultas', nome: 'HUMBERTO CONSULTAS DE JUNHO' },
          ],
        };
      }
      if (producaoId === 'p-camilla-bulk') {
        return {
          lotes: [
            { id: 'lote-cir', nome: 'CIRURGIAS - 05/07' },
            { id: 'lote-imob', nome: 'IMOBILIZAÇÕES - 05/07' },
          ],
        };
      }
      return { lotes: [] };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioFixtureBulk);
    mockListarEmpresas.mockResolvedValue([]);
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: [] });
    mockLotesPadrao();
  });

  it('processa Angiologista, Pediatra-com-sub-lote e Imobilizações-VH automaticamente no disparo em lote', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-bulk-1' });
    renderComProviders();

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });
    await screen.findByText('Dra. Samanta');
    await screen.findByText('Dr. Humberto Bulk');
    await screen.findByText('Dra. Camilla Bulk');

    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-samanta'));
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-humberto-bulk'));
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-camilla-bulk'));

    const botao = () => screen.getByRole('button', { name: /Processar \d+ médicos/ });
    await waitFor(() => expect(botao()).toHaveTextContent('Processar 3 médicos'));
    await waitFor(() => expect(botao()).toBeEnabled());
    fireEvent.click(botao());

    await waitFor(() => expect(mockDisparar).toHaveBeenCalled());
    const selecoes = mockDisparar.mock.calls[0]![1] as Record<string, unknown>[];

    const samanta = selecoes.find((s) => s.medicoId === 'm-samanta');
    expect(samanta).toMatchObject({
      producaoExternaId: null,
      producaoNome: null,
      producaoCateterExternaIds: ['lote-cateter'],
      producaoFistulaExternaIds: ['lote-fistula'],
      producaoAngiografiaExternaIds: ['lote-pacote'],
      producaoCartaRedeExternaId: 'lote-carta',
    });

    const humberto = selecoes.find((s) => s.medicoId === 'm-humberto-bulk');
    expect(humberto).toMatchObject({
      producaoExternaId: null,
      producaoConsultasLoteExternaIds: ['lote-consultas'],
      producaoGuiasLoteExternaIds: ['lote-1q'],
    });

    const camilla = selecoes.find((s) => s.medicoId === 'm-camilla-bulk');
    expect(camilla).toMatchObject({
      producaoExternaId: null,
      producaoGuiasLoteExternaIds: ['lote-cir'],
      producaoImobilizacoesLoteExternaIds: ['lote-imob'],
    });
  });

  it('sub-lote de Angiologista com nome não reconhecido vai para "Requer atenção manual" e não entra no disparo', async () => {
    mockLotes.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'p-samanta'
        ? { lotes: [{ id: 'lote-cateter', nome: 'SAMANTA CATETER 1Q' }, { id: 'lote-estranho', nome: 'SAMANTA EXTRA' }] }
        : { lotes: [] },
    );
    renderComProviders();
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });

    await screen.findByText('Requer atenção manual (1)');
    expect(screen.getByText(/Cateter\/Fístula\/Angiografia\/Carta de Rede\)/)).toBeInTheDocument();
    const prontos = screen.getByText(/Prontos para processar/).closest('div')!;
    expect(prontos).not.toHaveTextContent('Dra. Samanta');
  });

  it('preenchendo Carta de Rede — guias no disparo em lote, o número entra no payload do Angiologista', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-bulk-2' });
    renderComProviders();
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });
    await screen.findByText('Dra. Samanta');
    await waitFor(() => expect(screen.getByRole('button', { name: /Processar \d+ médicos/ })).toHaveTextContent('Processar 3 médicos'));

    fireEvent.change(screen.getByLabelText('Carta de Rede — guias de Dra. Samanta (opcional)'), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Processar \d+ médicos/ }));

    await waitFor(() => expect(mockDisparar).toHaveBeenCalled());
    const selecoes = mockDisparar.mock.calls[0]![1] as Record<string, unknown>[];
    expect(selecoes.find((s) => s.medicoId === 'm-samanta')).toMatchObject({ cartaRedeGuias: 7 });
  });
});

// Achado 2026-09-04 (feedback do dono): mesmo achado do modo "Por médico", mas no disparo em
// lote — a origem gera as guias de Consultas do Pediatra com 1 mês de atraso, então a competência
// disparada (ex.: agosto) precisa buscar o sub-lote de Consultas na produção mensal de JULHO.
describe('NovaExecucao — modo "Por competência": sub-lote de Consultas do mês ANTERIOR (achado 2026-09-04)', () => {
  const medicoOtavia = {
    id: 'm-otavia', nome: 'Dra. Otavia', ativo: true, necessitaConfiguracao: false,
    externalId: 'ext-otavia', especialidade: 'Pediatria',
  };
  const apoioOtaviaFixture = {
    medicos: [medicoOtavia],
    clientesOrigem: [
      {
        id: 'ext-otavia',
        nome: 'Otavia',
        producoes: [
          { id: 'p-otavia-julho', nome: 'JULHO - 2026' },
          { id: 'p-otavia-agosto', nome: 'AGOSTO - 2026' },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioOtaviaFixture);
    mockListarEmpresas.mockResolvedValue([]);
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: [] });
    mockLotes.mockImplementation(async (...args: unknown[]) => {
      const producaoId = args[0];
      if (producaoId === 'p-otavia-agosto') {
        return { lotes: [{ id: 'lote-ago-1q', nome: 'OTAVIA 1Q' }] };
      }
      if (producaoId === 'p-otavia-julho') {
        return { lotes: [{ id: 'lote-jul-consultas', nome: 'OTAVIA CONSULTAS DE JULHO' }] };
      }
      return { lotes: [] };
    });
  });

  it('casa a competência de agosto com a produção "AGOSTO - 2026" e busca Consultas na de julho', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-otavia' });
    renderComProviders();
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-08' } });
    await screen.findByText('Dra. Otavia');

    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-otavia-agosto'));
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-otavia-julho'));

    const botao = () => screen.getByRole('button', { name: /Processar \d+ médicos/ });
    await waitFor(() => expect(botao()).toBeEnabled());
    fireEvent.click(botao());

    await waitFor(() => expect(mockDisparar).toHaveBeenCalled());
    const selecoes = mockDisparar.mock.calls[0]![1] as Record<string, unknown>[];
    expect(selecoes.find((s) => s.medicoId === 'm-otavia')).toMatchObject({
      producaoExternaId: null,
      producaoConsultasLoteExternaIds: ['lote-jul-consultas'],
      producaoGuiasLoteExternaIds: ['lote-ago-1q'],
    });
  });
});

// Planilha de guias CONFERIDAS MANUALMENTE (migration 0058, aprovado 2026-09-03) — modo
// "Por competência". O ponto crítico é a EXECUÇÃO MISTA: o total da planilha entra no payload só
// dos médicos que vieram nela; os demais seguem 100% na contagem automática. E nada disso pode
// acontecer sem o operador ver, médico por médico, antes de confirmar (é dinheiro real).
describe('NovaExecucao — planilha de guias manuais (migration 0058)', () => {
  const arquivo = new File(['cpf,nome,competencia,total_guias,motivo'], 'guias.csv', { type: 'text/csv' });

  const previewFixture = {
    linhas: [
      {
        linha: 2,
        medicoId: 'm1',
        medicoNome: 'Dr. Alfa',
        cpf: '11144477735',
        nomePlanilha: 'Dr. Alfa',
        competencia: '2026-06',
        guiasManuaisTotal: 42,
        guiasManuaisMotivo: 'Conferencia manual do dono',
      },
    ],
    erros: [{ linha: 3, chave: '00000000191', erro: 'CPF 00000000191 não encontrado no cadastro de médicos' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApoio.mockResolvedValue(apoioFixture);
    mockListarEmpresas.mockResolvedValue([empresaFixture]);
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: [] });
    mockPreviewGuiasManuais.mockResolvedValue(previewFixture);
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-1' });
  });

  async function enviarPlanilha() {
    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-06' } });
    await screen.findByText(/Prontos para processar/);
    fireEvent.change(screen.getByLabelText('Planilha de guias conferidas manualmente'), {
      target: { files: [arquivo] },
    });
    await waitFor(() => expect(mockPreviewGuiasManuais).toHaveBeenCalledWith(arquivo, '2026-06'));
  }

  it('o preview mostra os médicos casados e os erros de linha, e ainda NÃO afeta o disparo', async () => {
    renderComProviders();
    await enviarPlanilha();

    await screen.findByText(/1 médico\(s\) casado\(s\) por CPF/);
    expect(screen.getByText(/CPF 11144477735 · linha 2 · Conferencia manual do dono/)).toBeInTheDocument();
    expect(screen.getByText(/não encontrado no cadastro/)).toBeInTheDocument();

    // Antes de aplicar, o botão de disparo não anuncia nenhuma contagem manual.
    expect(screen.getByRole('button', { name: /^Processar \d+ médicos$/ })).toBeInTheDocument();
  });

  it('ao aplicar, mescla o total só no médico da planilha — os outros seguem automáticos', async () => {
    renderComProviders();
    await enviarPlanilha();

    fireEvent.click(await screen.findByRole('button', { name: /Aplicar a 1 médico/ }));

    // O operador vê quem vai entrar com contagem manual ANTES de confirmar.
    await screen.findByText(/Contagem MANUAL: 42 guias — Conferencia manual do dono/);
    expect(screen.getByRole('button', { name: /com contagem manual/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Processar \d+ médicos/ }));

    await waitFor(() => expect(mockDisparar).toHaveBeenCalled());
    const selecoes = mockDisparar.mock.calls[0]![1] as Record<string, unknown>[];
    const alfa = selecoes.find((s) => s.medicoId === 'm1')!;
    const beta = selecoes.find((s) => s.medicoId === 'm2')!;
    expect(alfa).toMatchObject({ guiasManuaisTotal: 42, guiasManuaisMotivo: 'Conferencia manual do dono' });
    expect(beta.guiasManuaisTotal).toBeUndefined();
    expect(beta.guiasManuaisMotivo).toBeUndefined();
  });

  it('"Remover contagem manual" volta todo mundo para o fluxo automático', async () => {
    renderComProviders();
    await enviarPlanilha();
    fireEvent.click(await screen.findByRole('button', { name: /Aplicar a 1 médico/ }));
    await screen.findByText(/Contagem MANUAL: 42 guias/);

    fireEvent.click(screen.getByRole('button', { name: 'Remover contagem manual' }));

    await waitFor(() => expect(screen.queryByText(/Contagem MANUAL: 42 guias/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Processar \d+ médicos/ }));
    await waitFor(() => expect(mockDisparar).toHaveBeenCalled());
    const selecoes = mockDisparar.mock.calls[0]![1] as Record<string, unknown>[];
    expect(selecoes.every((s) => s.guiasManuaisTotal === undefined)).toBe(true);
  });

  it('trocar a competência invalida a planilha (foi validada contra o mês anterior)', async () => {
    renderComProviders();
    await enviarPlanilha();
    fireEvent.click(await screen.findByRole('button', { name: /Aplicar a 1 médico/ }));
    await screen.findByText(/Contagem MANUAL: 42 guias/);

    fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-07' } });

    await screen.findByText(/A planilha foi lida para a competência 2026-06 e não vale para 2026-07/);
    expect(screen.queryByText(/Contagem MANUAL: 42 guias/)).not.toBeInTheDocument();
  });

  it('avisa quando um médico da planilha não entra na emissão (já tem boleto) em vez de silenciar', async () => {
    mockMedicosComBoleto.mockResolvedValue({ medicoIds: ['m1'] }); // Dr. Alfa fora da seleção
    renderComProviders();
    await enviarPlanilha();

    fireEvent.click(await screen.findByRole('button', { name: /Aplicar a 1 médico/ }));

    await screen.findByText(/1 médico\(s\) da planilha NÃO entram nesta emissão/);
    expect(screen.getByText(/Dr. Alfa \(42 guias\)/)).toBeInTheDocument();
  });
});
