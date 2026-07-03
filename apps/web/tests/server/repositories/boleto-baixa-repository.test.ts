// Testes de registrarBaixa e registrarEvento (Story 4.1) com Supabase admin mockado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import {
  registrarBaixa,
  registrarEvento,
} from '@/server/repositories/boleto-repository';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registrarBaixa', () => {
  it('atualiza o boleto por id_externo e devolve atualizado=true', async () => {
    const rowAtualizada = {
      id: 'b1', execucao_resultado_id: 'r1', gateway: 'cora', id_externo: 'inv_1',
      status: 'pago', emitido_por: 'u1', emitido_em: '2026-06-01T00:00:00Z', payload_resposta: {},
      vencimento: '2026-07-01', pago_em: '2026-06-15T00:00:00Z', valor_pago: 1500, atualizado_em: '2026-06-15T00:00:00Z',
    };
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [rowAtualizada], error: null }),
    });

    const res = await registrarBaixa('inv_1', { status: 'pago', pagoEm: '2026-06-15T00:00:00Z', valorPago: 1500 });
    expect(res.atualizado).toBe(true);
    expect(res.boleto?.status).toBe('pago');
    expect(res.boleto?.valorPago).toBe(1500);
  });

  it('evento órfão (0 linhas) → atualizado=false, boleto=null', async () => {
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const res = await registrarBaixa('inexistente', { status: 'pago', pagoEm: null, valorPago: null });
    expect(res.atualizado).toBe(false);
    expect(res.boleto).toBeNull();
  });
});

describe('registrarEvento (idempotência)', () => {
  it('evento inédito → insere e devolve novo=true', async () => {
    // 1ª chamada from(): dedupe (não encontra)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    // 2ª chamada from(): insert
    mockFrom.mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'ev1', boleto_id: null, id_externo: 'inv_1', evento_id: 'evt_1',
          evento_tipo: 'invoice.paid', status_reconsultado: 'paid', payload: {}, recebido_em: '2026-06-15T00:00:00Z',
        },
        error: null,
      }),
    });

    const res = await registrarEvento({
      idExterno: 'inv_1', eventoId: 'evt_1', eventoTipo: 'invoice.paid', payload: {},
    });
    expect(res.novo).toBe(true);
    expect(res.evento.eventoId).toBe('evt_1');
  });

  it('evento repetido (mesmo evento_id) → devolve existente com novo=false (dedupe)', async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'ev1', boleto_id: 'b1', id_externo: 'inv_1', evento_id: 'evt_1',
          evento_tipo: 'invoice.paid', status_reconsultado: 'paid', payload: {}, recebido_em: '2026-06-15T00:00:00Z',
        },
        error: null,
      }),
    });

    const res = await registrarEvento({
      idExterno: 'inv_1', eventoId: 'evt_1', eventoTipo: 'invoice.paid', payload: {},
    });
    expect(res.novo).toBe(false);
    expect(res.evento.id).toBe('ev1');
  });
});
