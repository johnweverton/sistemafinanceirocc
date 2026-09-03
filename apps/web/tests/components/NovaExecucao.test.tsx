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
// de consultas ambulatoriais, tudo dentro da mesma produção mensal (ex.: "JULHO - 2026"). Marcar
// um sub-lote como consulta precisa automaticamente fazer o principal virar "soma dos OUTROS
// sub-lotes" — nunca o pacote completo (senão o sub-lote de consulta seria cobrado 2x).
describe('NovaExecucao — modo "Por médico": sub-lotes de consulta de pediatria (achado 2026-08-21)', () => {
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
    // Espera a busca de sub-lotes (fin-lotes) resolver e popular o seletor de consultas.
    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-julho'));
  }

  it('lista os sub-lotes da produção selecionada no seletor de "Produção de consultas"', async () => {
    renderComProviders();
    await selecionarMedicoEProducao();

    const select = screen.getByLabelText(/Produção de consultas/) as HTMLSelectElement;
    const opcoes = Array.from(select.options).map((o) => o.textContent);
    expect(opcoes).toEqual(
      expect.arrayContaining(['HUMBERTO 1Q', 'HUMBERTO 2Q', 'HUMBERTO CONSULTAS DE JUNHO']),
    );
  });

  it('escolher um sub-lote como consulta zera producaoExternaId e envia os OUTROS sub-lotes como guia principal', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-1' });
    renderComProviders();
    await selecionarMedicoEProducao();

    fireEvent.change(screen.getByLabelText(/Produção de consultas/), {
      target: { value: 'lote-consultas' },
    });
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

  it('sem marcar nenhum sub-lote como consulta, mantém o comportamento atual (pacote completo, sem regressão)', async () => {
    mockDisparar.mockResolvedValue({ execucaoId: 'exec-2' });
    renderComProviders();
    await selecionarMedicoEProducao();

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
    const [, selecoesEnviadas] = mockDisparar.mock.calls[0]!;
    expect(selecoesEnviadas[0]).not.toHaveProperty('producaoConsultasLoteExternaIds');
    expect(selecoesEnviadas[0]).not.toHaveProperty('producaoGuiasLoteExternaIds');
  });

  it('trocar de Produção limpa a seleção de consultas (evita sub-lote "fantasma" da produção anterior)', async () => {
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

    fireEvent.change(screen.getByLabelText(/Produção de consultas/), {
      target: { value: 'lote-consultas' },
    });
    expect((screen.getByLabelText(/Produção de consultas/) as HTMLSelectElement).value).toBe('lote-consultas');

    // Troca para a produção mensal de Agosto — a seleção de consultas de Julho é outro namespace
    // de ids (fin-lotes), não deveria continuar "selecionada" numa produção diferente.
    fireEvent.change(screen.getByLabelText('Produção'), { target: { value: 'p-agosto' } });

    await waitFor(() => expect(mockLotes).toHaveBeenCalledWith('p-agosto'));
    expect((screen.getByLabelText(/Produção de consultas/) as HTMLSelectElement).value).toBe('');
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
