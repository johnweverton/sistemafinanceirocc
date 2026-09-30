// GET /api/clientes-contabilidade/faturamentos/propostas-iss (Story 13.3) — deps mockadas, espelho
// de com-boleto-route.test.ts. Leitura pura: nada é gravado (decisão G3).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockVigentes = vi.fn();
const mockUltimaExecucao = vi.fn();
vi.mock('@/server/repositories/iss-captura-repository', () => ({
  listarPropostasIssVigentes: (...a: unknown[]) => mockVigentes(...a),
  buscarUltimaExecucaoIss: (...a: unknown[]) => mockUltimaExecucao(...a),
}));

const mockLancados = vi.fn();
vi.mock('@/server/repositories/cliente-contabilidade-faturamento-repository', () => ({
  listarFaturamentosDaCompetencia: (...a: unknown[]) => mockLancados(...a),
}));

import { ApiError } from '@/lib/api-error';
import { GET, dynamic } from '@/app/api/clientes-contabilidade/faturamentos/propostas-iss/route';

function reqGet(qs: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/clientes-contabilidade/faturamentos/propostas-iss${qs}`), {
    params: {} as Record<string, never>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVigentes.mockResolvedValue([]);
  mockUltimaExecucao.mockResolvedValue(null);
  mockLancados.mockResolvedValue([]);
});

describe('GET /api/clientes-contabilidade/faturamentos/propostas-iss', () => {
  it('junta propostas vigentes, última execução e lançados da competência', async () => {
    const proposta = { id: 'cap-1', clienteContabilidadeId: 'cc-1', status: 'capturado' };
    const execucao = {
      id: 'exec-1',
      competencia: '2026-08',
      iniciadoEm: '2026-09-21T13:40:00Z',
      finalizadoEm: null,
      totais: { capturado: 1, nao_encontrado: 0, sem_escrituracao: 0, erro: 0 },
    };
    mockVigentes.mockResolvedValue([proposta]);
    mockUltimaExecucao.mockResolvedValue(execucao);
    mockLancados.mockResolvedValue([{ clienteContabilidadeId: 'cc-2', faturamento: 5000 }]);

    const res = await reqGet('?competencia=2026-08');

    expect(res.status).toBe(200);
    expect(mockVigentes).toHaveBeenCalledWith('2026-08');
    expect(mockUltimaExecucao).toHaveBeenCalledWith('2026-08');
    expect(mockLancados).toHaveBeenCalledWith('2026-08');
    expect(await res.json()).toEqual({
      competencia: '2026-08',
      propostas: [proposta],
      ultimaExecucao: execucao,
      lancados: [{ clienteContabilidadeId: 'cc-2', faturamento: 5000 }],
    });
  });

  it('competência sem execução do agente → propostas vazias e ultimaExecucao null', async () => {
    const body = await (await reqGet('?competencia=2026-08')).json();
    expect(body).toMatchObject({ propostas: [], ultimaExecucao: null, lancados: [] });
  });

  it.each(['', '?competencia=2026-13', '?competencia=agosto'])('competência inválida (%s) → 400', async (qs) => {
    const res = await reqGet(qs);
    expect(res.status).toBe(400);
    expect(mockVigentes).not.toHaveBeenCalled();
  });

  it('exige papel de operador (o token do agente NÃO vale aqui)', async () => {
    mockRequireRole.mockRejectedValue(new ApiError(403, 'Sem permissão', 'FORBIDDEN'));
    const res = await GET(new Request('http://test/x?competencia=2026-08'), {
      params: {} as Record<string, never>,
    });
    expect(res.status).toBe(403);
    expect(mockVigentes).not.toHaveBeenCalled();
  });

  it('não cacheia: precisa refletir o que o agente acabou de enviar', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});
