// Testes da rota GET /api/extrato/exportar-ofx (Fase 1 da exportação financeiro→contábil).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockListarTransacoes = vi.fn();
vi.mock('@/server/repositories/extrato-repository', () => ({
  listarTransacoes: (...a: unknown[]) => mockListarTransacoes(...a),
}));

import { GET } from '@/app/api/extrato/exportar-ofx/route';

function reqGet(qs: string) {
  mockRequireRole.mockResolvedValue({ userId: 'u1', papel: 'financeiro' });
  return GET(new Request(`http://test/api/extrato/exportar-ofx${qs}`), { params: {} as Record<string, never> });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/extrato/exportar-ofx', () => {
  it('exige papel admin/financeiro', async () => {
    mockListarTransacoes.mockResolvedValue([]);
    await reqGet('?conta=mc&inicio=2026-07-01&fim=2026-07-31');
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
  });

  it('sem parâmetros obrigatórios → 400, não chama o repositório', async () => {
    const res = await reqGet('?conta=mc');
    expect(res.status).toBe(400);
    expect(mockListarTransacoes).not.toHaveBeenCalled();
  });

  it('conta inválida → 400', async () => {
    const res = await reqGet('?conta=banco-invalido&inicio=2026-07-01&fim=2026-07-31');
    expect(res.status).toBe(400);
  });

  it('devolve arquivo OFX com Content-Type e nome de arquivo corretos', async () => {
    mockListarTransacoes.mockResolvedValue([
      {
        entryId: 'ent1',
        tipo: 'CREDIT',
        valor: 500,
        dataTransacao: '2026-07-10T12:00:00Z',
        contraparteNome: 'Fulano',
        descricao: 'Pagamento',
      },
    ]);
    const res = await reqGet('?conta=cavalcante_viana&inicio=2026-07-01&fim=2026-07-31');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/x-ofx');
    expect(res.headers.get('Content-Disposition')).toContain('extrato-cavalcante_viana-2026-07-01-a-2026-07-31.ofx');
    const body = await res.text();
    expect(body).toContain('<FITID>ent1');
    expect(body).toContain('<TRNAMT>500.00');
  });

  it('aplica offset -03:00 no período (mesmo ajuste da rota GET /api/extrato, OBS-822)', async () => {
    mockListarTransacoes.mockResolvedValue([]);
    await reqGet('?conta=mc&inicio=2026-07-01&fim=2026-07-31');
    expect(mockListarTransacoes).toHaveBeenCalledWith({
      contaEmissora: 'mc',
      dataInicio: '2026-07-01T00:00:00.000-03:00',
      dataFim: '2026-07-31T23:59:59.999-03:00',
    });
  });
});
