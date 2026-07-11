// Testes da rota GET /api/dre/relatorio (Story 9.2, AC 7) — deps mockadas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockGerarRelatorioDre = vi.fn();
vi.mock('@/server/repositories/dre-repository', () => ({
  gerarRelatorioDre: (...a: unknown[]) => mockGerarRelatorioDre(...a),
}));

import { GET } from '@/app/api/dre/relatorio/route';

function reqGet(qs: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/dre/relatorio${qs}`), { params: {} as Record<string, never> });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/dre/relatorio', () => {
  it('repassa período e conta ao repository', async () => {
    mockGerarRelatorioDre.mockResolvedValue({ porCategoria: [], totalReceitas: 0, totalDeducoes: 0, totalDespesasOperacionais: 0, totalDespesasFinanceiras: 0, resultadoLiquido: 0 });
    const res = await reqGet('?inicio=2026-07-01&fim=2026-07-31&conta=mc');
    expect(res.status).toBe(200);
    expect(mockGerarRelatorioDre).toHaveBeenCalledWith({ inicio: '2026-07-01', fim: '2026-07-31' }, 'mc');
  });

  it('conta ausente → chama com undefined (consolidado)', async () => {
    mockGerarRelatorioDre.mockResolvedValue({ porCategoria: [] });
    await reqGet('?inicio=2026-07-01&fim=2026-07-31');
    expect(mockGerarRelatorioDre).toHaveBeenCalledWith({ inicio: '2026-07-01', fim: '2026-07-31' }, undefined);
  });

  it('sem inicio/fim → 400', async () => {
    const res = await reqGet('');
    expect(res.status).toBe(400);
    expect(mockGerarRelatorioDre).not.toHaveBeenCalled();
  });

  it('data malformada → 400', async () => {
    const res = await reqGet('?inicio=01/07/2026&fim=2026-07-31');
    expect(res.status).toBe(400);
  });

  it('conta fora da whitelist → 400', async () => {
    const res = await reqGet('?inicio=2026-07-01&fim=2026-07-31&conta=banco-x');
    expect(res.status).toBe(400);
  });
});
