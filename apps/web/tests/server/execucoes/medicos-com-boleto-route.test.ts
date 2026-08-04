// Testes da rota GET /api/execucoes/medicos-com-boleto (achado 2026-08-04) — deps mockadas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockListarMedicosComBoletoAtivo = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  listarMedicosComBoletoAtivo: (...a: unknown[]) => mockListarMedicosComBoletoAtivo(...a),
}));

import { GET } from '@/app/api/execucoes/medicos-com-boleto/route';

function reqGet(qs: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/execucoes/medicos-com-boleto${qs}`), { params: {} as Record<string, never> });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/execucoes/medicos-com-boleto', () => {
  it('repassa a competência e devolve os ids como array', async () => {
    mockListarMedicosComBoletoAtivo.mockResolvedValue(new Set(['m1', 'm2']));
    const res = await reqGet('?competencia=2026-06');
    expect(res.status).toBe(200);
    expect(mockListarMedicosComBoletoAtivo).toHaveBeenCalledWith('2026-06');
    const body = await res.json();
    expect(body.medicoIds.sort()).toEqual(['m1', 'm2']);
  });

  it('sem competência → 400, não chama o repositório', async () => {
    const res = await reqGet('');
    expect(res.status).toBe(400);
    expect(mockListarMedicosComBoletoAtivo).not.toHaveBeenCalled();
  });

  it('formato de competência inválido → 400', async () => {
    const res = await reqGet('?competencia=junho-2026');
    expect(res.status).toBe(400);
    expect(mockListarMedicosComBoletoAtivo).not.toHaveBeenCalled();
  });

  it('exige papel admin/colaborador/financeiro', async () => {
    mockListarMedicosComBoletoAtivo.mockResolvedValue(new Set());
    await reqGet('?competencia=2026-06');
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'colaborador', 'financeiro']);
  });
});
