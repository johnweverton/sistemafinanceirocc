// Testes da rota GET /api/relatorios/recebiveis/exportar-excel (Módulo de Relatórios).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockListarRecebiveis = vi.fn();
vi.mock('@/server/repositories/recebiveis-repository', () => ({
  listarRecebiveis: (...a: unknown[]) => mockListarRecebiveis(...a),
}));

import { GET } from '@/app/api/relatorios/recebiveis/exportar-excel/route';

function reqGet(qs: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/relatorios/recebiveis/exportar-excel${qs}`), {
    params: {} as Record<string, never>,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/relatorios/recebiveis/exportar-excel', () => {
  it('exige papel admin/financeiro', async () => {
    mockListarRecebiveis.mockResolvedValue([]);
    await reqGet('');
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
  });

  it('parâmetro inválido → 400, não gera arquivo', async () => {
    const res = await reqGet('?competencia=invalida');
    expect(res.status).toBe(400);
    expect(mockListarRecebiveis).not.toHaveBeenCalled();
  });

  it('devolve .xlsx com Content-Type e Content-Disposition corretos', async () => {
    mockListarRecebiveis.mockResolvedValue([]);
    const res = await reqGet('?competencia=2026-06&conta=mc');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('Content-Disposition')).toContain('recebiveis-2026-06-mc-todos.xlsx');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
  });

  it('sem filtros usa "todas"/"todos" no nome do arquivo', async () => {
    mockListarRecebiveis.mockResolvedValue([]);
    const res = await reqGet('');
    expect(res.headers.get('Content-Disposition')).toContain('recebiveis-todas-todas-todos.xlsx');
  });

  it('filtro tipoServico entra no nome do arquivo e é repassado ao repositório', async () => {
    mockListarRecebiveis.mockResolvedValue([]);
    const res = await reqGet('?tipoServico=contabilidade');
    expect(res.headers.get('Content-Disposition')).toContain('recebiveis-todas-todas-contabilidade.xlsx');
    expect(mockListarRecebiveis).toHaveBeenCalledWith(
      expect.objectContaining({ tipoServico: 'contabilidade' }),
    );
  });
});
