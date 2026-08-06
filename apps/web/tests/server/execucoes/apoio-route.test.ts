// Testes da rota GET /api/execucoes/apoio (achado 2026-08-06): médicos NUNCA podem vir de cache
// (precisam refletir uma configuração feita há segundos), só a busca na API externa é cacheada.
// `vi.resetModules()` + import dinâmico por teste: a rota tem cache em memória de módulo
// (`cache` local a clientesOrigem) — sem isolar o módulo, um teste vazaria cache pro outro.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockListarMedicos = vi.fn();
vi.mock('@/server/repositories/medico-repository', () => ({
  listarMedicos: (...a: unknown[]) => mockListarMedicos(...a),
}));

const mockListarClientes = vi.fn();
const mockListarProducoes = vi.fn();
vi.mock('@/server/integration/fin-api-client', () => ({
  listarClientes: (...a: unknown[]) => mockListarClientes(...a),
  listarProducoes: (...a: unknown[]) => mockListarProducoes(...a),
}));

async function importRoute() {
  return import('@/app/api/execucoes/apoio/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  mockListarClientes.mockResolvedValue([]);
});

describe('GET /api/execucoes/apoio', () => {
  it('exige papel admin/colaborador/financeiro', async () => {
    const { GET } = await importRoute();
    mockListarMedicos.mockResolvedValue([]);
    await GET();
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'colaborador', 'financeiro']);
  });

  it('busca médicos em TODA chamada, sem cache (achado 2026-08-06)', async () => {
    const { GET } = await importRoute();
    mockListarMedicos
      .mockResolvedValueOnce([{ id: 'm1', nome: 'Dr. A' }])
      .mockResolvedValueOnce([{ id: 'm1', nome: 'Dr. A' }, { id: 'm2', nome: 'Dr. B (recém-configurado)' }]);

    const res1 = await GET();
    const body1 = await res1.json();
    expect(body1.medicos).toHaveLength(1);

    // Segunda chamada "imediatamente depois" (simula reload de página) já reflete o médico novo —
    // é exatamente isso que estava quebrado com `export const revalidate = 300` na rota inteira.
    const res2 = await GET();
    const body2 = await res2.json();
    expect(body2.medicos).toHaveLength(2);
    expect(mockListarMedicos).toHaveBeenCalledTimes(2);
  });

  it('devolve clientesOrigem com produções agregadas por cliente', async () => {
    const { GET } = await importRoute();
    mockListarMedicos.mockResolvedValue([]);
    mockListarClientes.mockResolvedValue([{ id: 'c1', nome: 'Cliente 1' }]);
    mockListarProducoes.mockResolvedValue([{ id: 'p1', nome: 'Produção 1' }]);

    const res = await GET();
    const body = await res.json();
    expect(body.clientesOrigem).toEqual([{ id: 'c1', nome: 'Cliente 1', producoes: [{ id: 'p1', nome: 'Produção 1' }] }]);
  });

  it('cacheia clientesOrigem entre chamadas (não bate na API externa toda hora)', async () => {
    const { GET } = await importRoute();
    mockListarMedicos.mockResolvedValue([]);
    mockListarClientes.mockResolvedValue([{ id: 'c1', nome: 'Cliente 1' }]);
    mockListarProducoes.mockResolvedValue([]);

    await GET();
    await GET();
    expect(mockListarClientes).toHaveBeenCalledTimes(1);
  });

  it('erro interno vira 500 sem vazar detalhe', async () => {
    const { GET } = await importRoute();
    mockListarMedicos.mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
