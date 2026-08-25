// Story 12.1 (AC 3, 4) — SyncModal migrado para a casca `<Modal>`.
// É o caso mais delicado da migração: as duas confirmações (`ConfirmDialog`) eram renderizadas
// DENTRO da div do overlay; agora são irmãs do `<Modal>`, e a pilha interna do componente é quem
// garante que só o diálogo do topo reage a Escape/Tab.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/Toast';

const mockVincular = vi.fn();
const mockCriar = vi.fn();
const mockCriarTodos = vi.fn();
vi.mock('../../src/services/medicos', () => ({
  medicosService: {
    vincularExterno: (...a: unknown[]) => mockVincular(...a),
    criarExterno: (...a: unknown[]) => mockCriar(...a),
    criarTodosExternos: (...a: unknown[]) => mockCriarTodos(...a),
  },
  queryKeys: { medicos: () => ['medicos'] },
}));

import { SyncModal } from '../../src/components/medicos/SyncModal';

const clienteComSugestao = {
  id: 'ext-1',
  nome: 'JOAO DA SILVA',
  cpf: '11111111111',
  productionType: 'Produção Credenciada',
};
const clienteSemPar = {
  id: 'ext-2',
  nome: 'MARIA SOUZA',
  cpf: null,
  productionType: 'Produção VH',
};

const relatorio = {
  totalOrigem: 2,
  jaVinculados: 0,
  atualizados: 0,
  comSugestao: [
    {
      cliente: clienteComSugestao,
      candidatas: [{ medicoId: 'm1', nome: 'João da Silva', score: 0.95, viaCpf: true }],
    },
  ],
  semPar: [clienteSemPar],
  naoSincronizaveis: [],
};

function renderSync(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <SyncModal relatorio={relatorio} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => vi.clearAllMocks());

describe('SyncModal — casca acessível (AC 3, 4)', () => {
  it('é um diálogo com aria-modal e nome acessível vindo do título', () => {
    renderSync();

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(dialogo).toHaveAccessibleName('Sincronização com o Sistema Web');
    // O resumo da origem vira a descrição anunciada, não texto solto.
    expect(dialogo).toHaveAccessibleDescription(/2 clientes encontrados na origem/);
  });

  it('Escape fecha o modal', () => {
    const onClose = renderSync();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SyncModal — confirmação por cima do modal (pilha)', () => {
  it('a confirmação de vínculo empilha por cima e o Escape fecha só ela', async () => {
    const onClose = renderSync();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));

    fireEvent.keyDown(document, { key: 'Escape' });

    // Só a confirmação some; a sincronização continua na tela e o onClose não foi chamado.
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Sincronização com o Sistema Web');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('confirmar o vínculo ainda chama o service (comportamento de negócio intacto)', async () => {
    mockVincular.mockResolvedValue({ id: 'm1' });
    renderSync();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    const confirmacao = await screen.findByRole('dialog', { name: 'Confirmar vínculo' });
    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Confirmar vínculo' }));

    await waitFor(() =>
      expect(mockVincular).toHaveBeenCalledWith({ medicoId: 'm1', externalId: 'ext-1' }),
    );
  });

  it('criar todos passa pela confirmação antes de chamar o service', async () => {
    mockCriarTodos.mockResolvedValue({ criados: 1, ignorados: [] });
    renderSync();

    fireEvent.click(screen.getByRole('button', { name: 'Criar todos (1)' }));
    const confirmacao = await screen.findByRole('dialog', { name: 'Criar médicos em lote' });
    expect(mockCriarTodos).not.toHaveBeenCalled();

    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Criar todos (1)' }));

    await waitFor(() => expect(mockCriarTodos).toHaveBeenCalledWith({ externalIds: ['ext-2'] }));
  });
});
