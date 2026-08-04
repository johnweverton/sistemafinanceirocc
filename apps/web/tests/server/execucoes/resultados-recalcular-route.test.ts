// Testes da rota POST /api/execucoes/resultados/[id]/recalcular (migration 0041, achado real
// 2026-08-04) — deps mockadas, mesma trava de permissão de revisar/emitir.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockRecalcularResultado = vi.fn();
vi.mock('@/server/orchestrator/recalculo-resultado', () => ({
  recalcularResultado: (...a: unknown[]) => mockRecalcularResultado(...a),
}));

import { POST } from '@/app/api/execucoes/resultados/[id]/recalcular/route';

function reqPost(id: string) {
  mockRequireRole.mockResolvedValue({ userId: 'user-financeiro', papel: 'financeiro' });
  return POST(new Request('http://test/api/execucoes/resultados/x/recalcular', { method: 'POST' }), {
    params: { id },
  });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/execucoes/resultados/[id]/recalcular', () => {
  it('exige papel admin/financeiro e repassa o id + usuário ao orquestrador', async () => {
    mockRecalcularResultado.mockResolvedValue({ id: 'res-1', guias: 19 });
    const res = await reqPost('res-1');
    expect(res.status).toBe(200);
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
    expect(mockRecalcularResultado).toHaveBeenCalledWith('res-1', 'user-financeiro');
    const body = await res.json();
    expect(body.resultado).toEqual({ id: 'res-1', guias: 19 });
  });

  it('propaga o erro do orquestrador (ex.: boleto já emitido) sem mascarar', async () => {
    const { ApiError } = await import('@/lib/api-error');
    mockRecalcularResultado.mockRejectedValue(
      new ApiError(409, 'boleto já emitido', 'BOLETO_JA_EMITIDO'),
    );
    const res = await reqPost('res-1');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('BOLETO_JA_EMITIDO');
  });
});
