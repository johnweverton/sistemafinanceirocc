// Testes da rota GET /api/relatorios/recebiveis/exportar-pdf (Módulo de Relatórios).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockListarRecebiveis = vi.fn();
vi.mock('@/server/repositories/recebiveis-repository', () => ({
  listarRecebiveis: (...a: unknown[]) => mockListarRecebiveis(...a),
}));

import { GET } from '@/app/api/relatorios/recebiveis/exportar-pdf/route';

function reqGet(qs: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/relatorios/recebiveis/exportar-pdf${qs}`), {
    params: {} as Record<string, never>,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/relatorios/recebiveis/exportar-pdf', () => {
  it('exige papel admin/financeiro', async () => {
    mockListarRecebiveis.mockResolvedValue([]);
    await reqGet('');
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
  });

  it('conta inválida → 400, não gera arquivo', async () => {
    const res = await reqGet('?conta=banco-invalido');
    expect(res.status).toBe(400);
    expect(mockListarRecebiveis).not.toHaveBeenCalled();
  });

  it('devolve .pdf com Content-Type e Content-Disposition corretos', async () => {
    mockListarRecebiveis.mockResolvedValue([]);
    const res = await reqGet('?competencia=2026-06&conta=mc');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('recebiveis-2026-06-mc-todos.pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('filtro tipoServico entra no nome do arquivo e é repassado ao repositório', async () => {
    mockListarRecebiveis.mockResolvedValue([]);
    const res = await reqGet('?tipoServico=contabilidade');
    expect(res.headers.get('Content-Disposition')).toContain('recebiveis-todas-todas-contabilidade.pdf');
    expect(mockListarRecebiveis).toHaveBeenCalledWith(
      expect.objectContaining({ tipoServico: 'contabilidade' }),
    );
  });
});
