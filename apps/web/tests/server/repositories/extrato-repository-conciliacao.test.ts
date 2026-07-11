// Testes das extensões de conciliação do extrato-repository (Story 8.2) —
// updates condicionais (manual vence corrida), 23505 → 409/descarte, queries do matching.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import {
  buscarTransacao,
  listarCreditosParaMatching,
  aplicarTransicoesConciliacao,
  atualizarStatusConciliacao,
} from '@/server/repositories/extrato-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    in: vi.fn(() => builder),
    like: vi.fn(() => builder),
    not: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

const ROW = {
  id: 'tx-1', conta_emissora: 'mc', entry_id: 'e1', tipo: 'CREDIT', transaction_type: 'PAYMENT',
  valor: 1500, descricao: null, contraparte_nome: null, contraparte_documento: '12345678901',
  data_transacao: '2026-07-08T10:00:00Z', status_conciliacao: 'sem_match', boleto_id: null,
  conciliado_por: null, conciliado_em: null, payload: {}, sincronizado_em: '2026-07-10T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('buscarTransacao / listarCreditosParaMatching', () => {
  it('buscarTransacao mapeia a linha; null quando não existe', async () => {
    const b1 = makeBuilder({ data: ROW, error: null });
    mockFrom.mockReturnValueOnce(b1);
    const t = await buscarTransacao('tx-1');
    expect(t).toMatchObject({ id: 'tx-1', entryId: 'e1', statusConciliacao: 'sem_match' });

    mockFrom.mockReturnValueOnce(makeBuilder({ data: null, error: null }));
    expect(await buscarTransacao('tx-x')).toBeNull();
  });

  it('listarCreditosParaMatching filtra conta + CREDIT + estados recalculáveis', async () => {
    const builder = makeBuilder({ data: [ROW], error: null });
    mockFrom.mockReturnValueOnce(builder);

    const r = await listarCreditosParaMatching('mc');
    expect(r).toHaveLength(1);
    expect(builder.eq).toHaveBeenCalledWith('conta_emissora', 'mc');
    expect(builder.eq).toHaveBeenCalledWith('tipo', 'CREDIT');
    expect(builder.in).toHaveBeenCalledWith('status_conciliacao', ['sem_match', 'sugerido']);
  });
});

describe('aplicarTransicoesConciliacao (corrida: manual vence)', () => {
  it('update é CONDICIONAL ao estado recalculável e conta aplicadas', async () => {
    const builder = makeBuilder({ data: [{ id: 'tx-1' }], error: null });
    mockFrom.mockReturnValueOnce(builder);

    const r = await aplicarTransicoesConciliacao([
      { transacaoId: 'tx-1', status: 'conciliado_auto', boletoId: 'b1' },
    ]);

    expect(r).toEqual({ aplicadas: 1, descartadas: 0 });
    const patch = builder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.status_conciliacao).toBe('conciliado_auto');
    expect(patch.boleto_id).toBe('b1');
    expect(patch.conciliado_por).toBeNull(); // ação do sistema
    expect(typeof patch.conciliado_em).toBe('string');
    // O WHERE garante que ação manual concorrente vence.
    expect(builder.in).toHaveBeenCalledWith('status_conciliacao', ['sem_match', 'sugerido']);
  });

  it('estado mudou no meio (0 linhas) → transição descartada sem erro', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: [], error: null }));
    const r = await aplicarTransicoesConciliacao([
      { transacaoId: 'tx-1', status: 'sugerido', boletoId: 'b1' },
    ]);
    expect(r).toEqual({ aplicadas: 0, descartadas: 1 });
  });

  it('23505 (boleto conciliado em corrida) → descarta o auto e segue', async () => {
    mockFrom
      .mockReturnValueOnce(makeBuilder({ data: null, error: { code: '23505', message: 'dup' } }))
      .mockReturnValueOnce(makeBuilder({ data: [{ id: 'tx-2' }], error: null }));

    const r = await aplicarTransicoesConciliacao([
      { transacaoId: 'tx-1', status: 'conciliado_auto', boletoId: 'b1' },
      { transacaoId: 'tx-2', status: 'sem_match', boletoId: null },
    ]);
    expect(r).toEqual({ aplicadas: 1, descartadas: 1 });
  });

  it('sem_match limpa vínculo e trilha; sugerido guarda candidato sem trilha', async () => {
    const b1 = makeBuilder({ data: [{ id: 'tx-1' }], error: null });
    const b2 = makeBuilder({ data: [{ id: 'tx-2' }], error: null });
    mockFrom.mockReturnValueOnce(b1).mockReturnValueOnce(b2);

    await aplicarTransicoesConciliacao([
      { transacaoId: 'tx-1', status: 'sem_match', boletoId: null },
      { transacaoId: 'tx-2', status: 'sugerido', boletoId: 'b9' },
    ]);

    const patchSemMatch = b1.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patchSemMatch).toMatchObject({ status_conciliacao: 'sem_match', boleto_id: null, conciliado_em: null });
    const patchSugerido = b2.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patchSugerido).toMatchObject({ status_conciliacao: 'sugerido', boleto_id: 'b9', conciliado_por: null });
  });
});

describe('atualizarStatusConciliacao — 23505 → 409 (OBS-812)', () => {
  it('violação do UNIQUE parcial vira ApiError 409 BOLETO_JA_CONCILIADO', async () => {
    mockFrom.mockReturnValueOnce(
      makeBuilder({ data: null, error: { code: '23505', message: 'duplicate key' } }),
    );
    await expect(
      atualizarStatusConciliacao('tx-1', { status: 'conciliado_manual', boletoId: 'b1', usuarioId: 'u1' }),
    ).rejects.toMatchObject({ status: 409, code: 'BOLETO_JA_CONCILIADO' });
  });
});
