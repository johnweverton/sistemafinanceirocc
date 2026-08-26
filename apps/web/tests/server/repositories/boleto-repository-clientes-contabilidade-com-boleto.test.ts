// Teste de listarClientesContabilidadeComBoletoAtivo (Story 12.3, risco RS-1) — espelho do
// teste de médicos: clientes contábeis com boleto emitido/pago numa competência, em QUALQUER
// execução, pra que rodar o mesmo lote/mês duas vezes não gere cobrança duplicada.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { listarClientesContabilidadeComBoletoAtivo } from '@/server/repositories/boleto-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

beforeEach(() => vi.clearAllMocks());

describe('listarClientesContabilidadeComBoletoAtivo', () => {
  it('devolve o conjunto de cliente_contabilidade_id com boleto emitido/pago na competência', async () => {
    const builder = makeBuilder({
      data: [
        { execucao_resultados: { cliente_contabilidade_id: 'cc-1' } },
        { execucao_resultados: { cliente_contabilidade_id: 'cc-2' } },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(builder);

    const ids = await listarClientesContabilidadeComBoletoAtivo('2026-06');

    expect(ids).toEqual(new Set(['cc-1', 'cc-2']));
    expect(mockFrom).toHaveBeenCalledWith('boletos');
    expect(builder.eq).toHaveBeenCalledWith('execucao_resultados.execucoes.competencia', '2026-06');
  });

  // AC 2 — o filtro é `status in ('emitido','pago')`: boleto CANCELADO não conta como já
  // emitido, então cancelar e reemitir corrigido continua possível mesmo no bloqueio duro.
  it('filtra só status ativos — cancelado/falha não bloqueiam nova emissão', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValueOnce(builder);

    await listarClientesContabilidadeComBoletoAtivo('2026-06');

    expect(builder.in).toHaveBeenCalledWith('status', ['emitido', 'pago']);
    const statusFiltrados = builder.in.mock.calls[0][1] as string[];
    expect(statusFiltrados).not.toContain('cancelado');
    expect(statusFiltrados).not.toContain('falha');
  });

  it('cliente com dois boletos na competência (duplicata pré-existente) aparece uma vez só (Set)', async () => {
    mockFrom.mockReturnValueOnce(
      makeBuilder({
        data: [
          { execucao_resultados: { cliente_contabilidade_id: 'cc-1' } },
          { execucao_resultados: { cliente_contabilidade_id: 'cc-1' } },
        ],
        error: null,
      }),
    );

    const ids = await listarClientesContabilidadeComBoletoAtivo('2026-06');
    expect(ids).toEqual(new Set(['cc-1']));
  });

  // Resultado de médico/empresa tem cliente_contabilidade_id null (constraint da migration 0032)
  // — não pode virar um id fantasma no Set.
  it('ignora resultados sem cliente_contabilidade_id (boleto de médico/empresa)', async () => {
    mockFrom.mockReturnValueOnce(
      makeBuilder({
        data: [
          { execucao_resultados: { cliente_contabilidade_id: null } },
          { execucao_resultados: { cliente_contabilidade_id: 'cc-9' } },
        ],
        error: null,
      }),
    );

    const ids = await listarClientesContabilidadeComBoletoAtivo('2026-06');
    expect(ids).toEqual(new Set(['cc-9']));
  });

  it('sem boletos na competência → conjunto vazio', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: [], error: null }));
    const ids = await listarClientesContabilidadeComBoletoAtivo('2026-06');
    expect(ids.size).toBe(0);
  });

  it('erro do banco → propaga ApiError 500 (não devolve vazio, que abriria a guarda)', async () => {
    mockFrom.mockReturnValueOnce(makeBuilder({ data: null, error: { message: 'timeout' } }));
    await expect(listarClientesContabilidadeComBoletoAtivo('2026-06')).rejects.toThrow();
  });
});
