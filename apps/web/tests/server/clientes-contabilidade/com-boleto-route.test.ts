// Testes da rota GET /api/clientes-contabilidade/com-boleto (Story 12.3, risco RS-1) — deps
// mockadas, espelho de medicos-com-boleto-route.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockListarClientesContabilidadeComBoletoAtivo = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  listarClientesContabilidadeComBoletoAtivo: (...a: unknown[]) =>
    mockListarClientesContabilidadeComBoletoAtivo(...a),
}));

import { GET, dynamic } from '@/app/api/clientes-contabilidade/com-boleto/route';

function reqGet(qs: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/clientes-contabilidade/com-boleto${qs}`), {
    params: {} as Record<string, never>,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/clientes-contabilidade/com-boleto', () => {
  it('repassa a competência e devolve os ids como array', async () => {
    mockListarClientesContabilidadeComBoletoAtivo.mockResolvedValue(new Set(['cc-1', 'cc-2']));
    const res = await reqGet('?competencia=2026-06');
    expect(res.status).toBe(200);
    expect(mockListarClientesContabilidadeComBoletoAtivo).toHaveBeenCalledWith('2026-06');
    const body = await res.json();
    expect(body.clienteContabilidadeIds.sort()).toEqual(['cc-1', 'cc-2']);
  });

  it('cada competência é consultada isoladamente (troca de competência muda a resposta)', async () => {
    mockListarClientesContabilidadeComBoletoAtivo.mockResolvedValueOnce(new Set(['cc-1']));
    const jun = await (await reqGet('?competencia=2026-06')).json();
    mockListarClientesContabilidadeComBoletoAtivo.mockResolvedValueOnce(new Set());
    const jul = await (await reqGet('?competencia=2026-07')).json();

    expect(jun.clienteContabilidadeIds).toEqual(['cc-1']);
    expect(jul.clienteContabilidadeIds).toEqual([]);
    expect(mockListarClientesContabilidadeComBoletoAtivo).toHaveBeenNthCalledWith(1, '2026-06');
    expect(mockListarClientesContabilidadeComBoletoAtivo).toHaveBeenNthCalledWith(2, '2026-07');
  });

  it('sem competência → 400, não chama o repositório', async () => {
    const res = await reqGet('');
    expect(res.status).toBe(400);
    expect(mockListarClientesContabilidadeComBoletoAtivo).not.toHaveBeenCalled();
  });

  it('formato de competência inválido → 400', async () => {
    const res = await reqGet('?competencia=junho-2026');
    expect(res.status).toBe(400);
    expect(mockListarClientesContabilidadeComBoletoAtivo).not.toHaveBeenCalled();
  });

  it('exige papel admin/colaborador/financeiro', async () => {
    mockListarClientesContabilidadeComBoletoAtivo.mockResolvedValue(new Set());
    await reqGet('?competencia=2026-06');
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'colaborador', 'financeiro']);
  });

  // AC 1 — sem cache de propósito: a lista precisa refletir uma emissão feita há segundos.
  it('é force-dynamic (sem cache)', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});
