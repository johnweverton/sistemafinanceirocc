// Testes do extrato-repository (Story 8.1, AC 6) — getSupabaseAdmin mockado.
// Chave da story: upsert IDEMPOTENTE que nunca regride status de conciliação — o payload
// do upsert não pode conter as colunas de conciliação (re-sync de transação
// conciliado_manual mantém o status intacto no banco).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TransacaoExtratoApi } from '@cobranca/shared';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import {
  upsertTransacoes,
  registrarSync,
  ultimoSync,
  listarTransacoes,
  atualizarStatusConciliacao,
} from '@/server/repositories/extrato-repository';
import { ApiError } from '@/lib/api-error';

/** Builder "thenable" que registra as chamadas e resolve o resultado no await. */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    in: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

function transacao(entryId: string, extras: Partial<TransacaoExtratoApi> = {}): TransacaoExtratoApi {
  return {
    entryId,
    tipo: 'CREDIT',
    transactionType: 'PAYMENT',
    valor: 1500,
    descricao: 'Liquidação',
    contraparteNome: 'Dr. Teste',
    contraparteDocumento: '12345678901',
    dataTransacao: '2026-07-08T10:00:00Z',
    payload: { raw: true },
    ...extras,
  };
}

const ROW_COMPLETA = {
  id: 'tx-1',
  conta_emissora: 'mc',
  entry_id: 'e1',
  tipo: 'CREDIT',
  transaction_type: 'PAYMENT',
  valor: 1500,
  descricao: 'Liquidação',
  contraparte_nome: 'Dr. Teste',
  contraparte_documento: '12345678901',
  data_transacao: '2026-07-08T10:00:00Z',
  status_conciliacao: 'sem_match',
  boleto_id: null,
  conciliado_por: null,
  conciliado_em: null,
  payload: { raw: true },
  sincronizado_em: '2026-07-10T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('upsertTransacoes (idempotência do sync)', () => {
  it('período novo: tudo é insert → qtdNovas', async () => {
    const builderSelect = makeBuilder({ data: [], error: null });
    const builderUpsert = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValueOnce(builderSelect).mockReturnValueOnce(builderUpsert);

    const r = await upsertTransacoes('mc', [transacao('e1'), transacao('e2')]);

    expect(r).toEqual({ qtdNovas: 2, qtdAtualizadas: 0 });
    expect(builderSelect.eq).toHaveBeenCalledWith('conta_emissora', 'mc');
    expect(builderSelect.in).toHaveBeenCalledWith('entry_id', ['e1', 'e2']);
    expect(builderUpsert.upsert).toHaveBeenCalledWith(
      expect.any(Array),
      { onConflict: 'conta_emissora,entry_id' },
    );
  });

  it('re-sync: transação existente conta como atualizada, nova como nova', async () => {
    const builderSelect = makeBuilder({ data: [{ entry_id: 'e1' }], error: null });
    const builderUpsert = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValueOnce(builderSelect).mockReturnValueOnce(builderUpsert);

    const r = await upsertTransacoes('mc', [transacao('e1'), transacao('e2')]);
    expect(r).toEqual({ qtdNovas: 1, qtdAtualizadas: 1 });
  });

  it('NUNCA escreve colunas de conciliação: re-sync não regride conciliado_manual (AC 6)', async () => {
    const builderSelect = makeBuilder({ data: [{ entry_id: 'e1' }], error: null });
    const builderUpsert = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValueOnce(builderSelect).mockReturnValueOnce(builderUpsert);

    await upsertTransacoes('mc', [transacao('e1')]);

    const rows = builderUpsert.upsert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    // Colunas bancárias presentes…
    expect(rows[0]).toMatchObject({
      conta_emissora: 'mc',
      entry_id: 'e1',
      valor: 1500,
      contraparte_documento: '12345678901',
    });
    // …colunas de conciliação AUSENTES (o update do upsert só toca o que está no payload).
    expect(rows[0]).not.toHaveProperty('status_conciliacao');
    expect(rows[0]).not.toHaveProperty('boleto_id');
    expect(rows[0]).not.toHaveProperty('conciliado_por');
    expect(rows[0]).not.toHaveProperty('conciliado_em');
  });

  it('lista vazia → não toca o banco', async () => {
    const r = await upsertTransacoes('mc', []);
    expect(r).toEqual({ qtdNovas: 0, qtdAtualizadas: 0 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('erro do banco no upsert → ApiError 500', async () => {
    const builderSelect = makeBuilder({ data: [], error: null });
    const builderUpsert = makeBuilder({ data: null, error: { message: 'boom' } });
    mockFrom.mockReturnValueOnce(builderSelect).mockReturnValueOnce(builderUpsert);

    await expect(upsertTransacoes('mc', [transacao('e1')])).rejects.toThrowError(ApiError);
  });
});

describe('registrarSync / ultimoSync', () => {
  it('registra o sync com período, contagens e executor', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValueOnce(builder);

    await registrarSync('mc', { inicio: '2026-07-01', fim: '2026-07-10' }, { qtdNovas: 3, qtdAtualizadas: 1 }, 'user-1');

    expect(mockFrom).toHaveBeenCalledWith('extrato_syncs');
    expect(builder.insert).toHaveBeenCalledWith({
      conta_emissora: 'mc',
      periodo_inicio: '2026-07-01',
      periodo_fim: '2026-07-10',
      qtd_novas: 3,
      qtd_atualizadas: 1,
      executado_por: 'user-1',
    });
  });

  it('ultimoSync devolve o mais recente mapeado; null quando nunca sincronizou', async () => {
    const row = {
      id: 's1', conta_emissora: 'mc', periodo_inicio: '2026-07-01', periodo_fim: '2026-07-10',
      qtd_novas: 3, qtd_atualizadas: 1, executado_por: 'user-1', executado_em: '2026-07-10T12:00:00Z',
    };
    const builder = makeBuilder({ data: [row], error: null });
    mockFrom.mockReturnValueOnce(builder);

    const s = await ultimoSync('mc');
    expect(s).toMatchObject({ id: 's1', contaEmissora: 'mc', qtdNovas: 3, executadoEm: '2026-07-10T12:00:00Z' });
    expect(builder.order).toHaveBeenCalledWith('executado_em', { ascending: false });

    mockFrom.mockReturnValueOnce(makeBuilder({ data: [], error: null }));
    expect(await ultimoSync('cavalcante_viana')).toBeNull();
  });
});

describe('listarTransacoes', () => {
  it('mapeia linhas para o domínio (snake_case → camelCase)', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: [ROW_COMPLETA], error: null }));

    const r = await listarTransacoes();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: 'tx-1',
      contaEmissora: 'mc',
      entryId: 'e1',
      statusConciliacao: 'sem_match',
      valor: 1500,
    });
  });

  it('aplica filtros conta/período/status/tipo', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValueOnce(builder);

    await listarTransacoes({
      contaEmissora: 'mc',
      dataInicio: '2026-07-01',
      dataFim: '2026-07-10',
      status: 'sugerido',
      tipo: 'CREDIT',
    });

    expect(builder.eq).toHaveBeenCalledWith('conta_emissora', 'mc');
    expect(builder.gte).toHaveBeenCalledWith('data_transacao', '2026-07-01');
    expect(builder.lte).toHaveBeenCalledWith('data_transacao', '2026-07-10');
    expect(builder.eq).toHaveBeenCalledWith('status_conciliacao', 'sugerido');
    expect(builder.eq).toHaveBeenCalledWith('tipo', 'CREDIT');
  });

  it('sem filtros → não chama .eq', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValueOnce(builder);
    await listarTransacoes();
    expect(builder.eq).not.toHaveBeenCalled();
  });
});

describe('atualizarStatusConciliacao (transições com trilha)', () => {
  function builderUpdate(rowDevolvida: Record<string, unknown> = ROW_COMPLETA) {
    return makeBuilder({ data: [rowDevolvida], error: null });
  }

  it('conciliado_manual: grava boleto, quem e quando', async () => {
    const builder = builderUpdate();
    mockFrom.mockReturnValueOnce(builder);

    await atualizarStatusConciliacao('tx-1', {
      status: 'conciliado_manual',
      boletoId: 'b1',
      usuarioId: 'user-1',
    });

    const patch = builder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.status_conciliacao).toBe('conciliado_manual');
    expect(patch.boleto_id).toBe('b1');
    expect(patch.conciliado_por).toBe('user-1');
    expect(typeof patch.conciliado_em).toBe('string');
    expect(builder.eq).toHaveBeenCalledWith('id', 'tx-1');
  });

  it('conciliado_auto: trilha do sistema (conciliado_por null)', async () => {
    const builder = builderUpdate();
    mockFrom.mockReturnValueOnce(builder);

    await atualizarStatusConciliacao('tx-1', { status: 'conciliado_auto', boletoId: 'b1' });

    const patch = builder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.boleto_id).toBe('b1');
    expect(patch.conciliado_por).toBeNull();
    expect(typeof patch.conciliado_em).toBe('string');
  });

  it('conciliar sem boletoId → ApiError 400 sem tocar o banco', async () => {
    await expect(
      atualizarStatusConciliacao('tx-1', { status: 'conciliado_manual' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('sugerido: guarda o candidato sem trilha humana', async () => {
    const builder = builderUpdate();
    mockFrom.mockReturnValueOnce(builder);

    await atualizarStatusConciliacao('tx-1', { status: 'sugerido', boletoId: 'b1' });

    const patch = builder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.boleto_id).toBe('b1');
    expect(patch.conciliado_por).toBeNull();
    expect(patch.conciliado_em).toBeNull();
  });

  it('ignorado: sem boleto, com trilha de quem ignorou', async () => {
    const builder = builderUpdate();
    mockFrom.mockReturnValueOnce(builder);

    await atualizarStatusConciliacao('tx-1', { status: 'ignorado', usuarioId: 'user-2' });

    const patch = builder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.boleto_id).toBeNull();
    expect(patch.conciliado_por).toBe('user-2');
    expect(typeof patch.conciliado_em).toBe('string');
  });

  it('sem_match (desfazer): limpa vínculo e trilha — reversível (D2)', async () => {
    const builder = builderUpdate();
    mockFrom.mockReturnValueOnce(builder);

    await atualizarStatusConciliacao('tx-1', { status: 'sem_match' });

    const patch = builder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.boleto_id).toBeNull();
    expect(patch.conciliado_por).toBeNull();
    expect(patch.conciliado_em).toBeNull();
  });

  it('transação inexistente → ApiError 404', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: [], error: null }));
    await expect(
      atualizarStatusConciliacao('tx-x', { status: 'sem_match' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
