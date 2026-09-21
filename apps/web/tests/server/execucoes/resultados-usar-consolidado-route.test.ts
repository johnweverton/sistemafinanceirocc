// Testes da rota POST /api/execucoes/resultados/[id]/usar-consolidado (achado 2026-09-04) — deps
// mockadas, mesma trava de permissão de recalcular/revisar.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockUsarConsolidadoNoResultado = vi.fn();
vi.mock('@/server/orchestrator/recalculo-resultado', () => ({
  usarConsolidadoNoResultado: (...a: unknown[]) => mockUsarConsolidadoNoResultado(...a),
}));

import { POST } from '@/app/api/execucoes/resultados/[id]/usar-consolidado/route';

function reqPost(id: string, body: unknown) {
  mockRequireRole.mockResolvedValue({ userId: 'user-financeiro', papel: 'financeiro' });
  return POST(
    new Request('http://test/api/execucoes/resultados/x/usar-consolidado', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: { id } },
  );
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/execucoes/resultados/[id]/usar-consolidado', () => {
  it('exige papel admin/financeiro e repassa id + motivo + usuário ao orquestrador', async () => {
    mockUsarConsolidadoNoResultado.mockResolvedValue({ id: 'res-1', guias: 65 });
    const res = await reqPost('res-1', { motivo: 'Aceito o consolidado, atendimento em mais de 1 dia' });
    expect(res.status).toBe(200);
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
    expect(mockUsarConsolidadoNoResultado).toHaveBeenCalledWith(
      'res-1',
      'Aceito o consolidado, atendimento em mais de 1 dia',
      'user-financeiro',
    );
    const body = await res.json();
    expect(body.resultado).toEqual({ id: 'res-1', guias: 65 });
  });

  it('motivo ausente/curto → 422, nunca chama o orquestrador', async () => {
    const res = await reqPost('res-1', { motivo: 'oi' });
    expect(res.status).toBe(422);
    expect(mockUsarConsolidadoNoResultado).not.toHaveBeenCalled();
  });

  it('propaga o erro do orquestrador (ex.: sem divergência) sem mascarar', async () => {
    const { ApiError } = await import('@/lib/api-error');
    mockUsarConsolidadoNoResultado.mockRejectedValue(
      new ApiError(422, 'sem divergencia', 'SEM_DIVERGENCIA_CONSOLIDADO'),
    );
    const res = await reqPost('res-1', { motivo: 'Aceito o consolidado' });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('SEM_DIVERGENCIA_CONSOLIDADO');
  });
});
