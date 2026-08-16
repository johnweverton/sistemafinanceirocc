// Testes da rota GET /api/relatorios/recebiveis (preview do relatório, Módulo de Relatórios).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockListarRecebiveis = vi.fn();
vi.mock('@/server/repositories/recebiveis-repository', () => ({
  listarRecebiveis: (...a: unknown[]) => mockListarRecebiveis(...a),
}));

import { GET } from '@/app/api/relatorios/recebiveis/route';

function reqGet(qs: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/relatorios/recebiveis${qs}`), { params: {} as Record<string, never> });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/relatorios/recebiveis', () => {
  it('exige papel admin/financeiro', async () => {
    mockListarRecebiveis.mockResolvedValue([]);
    await reqGet('?competencia=2026-06');
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
  });

  it('competência em formato inválido → 400, não chama o repositório', async () => {
    const res = await reqGet('?competencia=2026-6');
    expect(res.status).toBe(400);
    expect(mockListarRecebiveis).not.toHaveBeenCalled();
  });

  it('conta inválida → 400', async () => {
    const res = await reqGet('?conta=banco-invalido');
    expect(res.status).toBe(400);
  });

  it('devolve o relatório agrupado por empresa', async () => {
    mockListarRecebiveis.mockResolvedValue([
      {
        boletoId: 'b1',
        execucaoResultadoId: 'er1',
        idExterno: 'ext1',
        competencia: '2026-06',
        medicoId: 'm1',
        nome: 'Dr. A',
        valor: 1000,
        vencimento: '2026-06-10',
        pagoEm: null,
        valorPago: null,
        emitidoEm: '2026-06-01T00:00:00Z',
        contaEmissora: 'mc',
        statusDerivado: 'em_aberto',
      },
    ]);
    const res = await reqGet('?competencia=2026-06&conta=mc');
    expect(res.status).toBe(200);
    expect(mockListarRecebiveis).toHaveBeenCalledWith({ competencia: '2026-06', contaEmissora: 'mc' });
    const body = await res.json();
    expect(body.grupos).toHaveLength(1);
    expect(body.grupos[0].contaEmissora).toBe('mc');
    expect(body.totalGeral.totalEmitido).toBe(1000);
  });
});
