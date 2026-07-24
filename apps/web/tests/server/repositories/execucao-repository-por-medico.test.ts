// Testes das funções novas da visão "Por médico" (migration 0013) — getSupabaseAdmin mockado,
// sem banco real. Segue o padrão "builder thenable" de recebiveis-repository.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import {
  listarResumoPorMedico,
  historicoResultadosPorMedico,
  historicoResultadosPorClienteContabilidade,
} from '@/server/repositories/execucao-repository';

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return builder;
}

beforeEach(() => vi.clearAllMocks());

describe('listarResumoPorMedico', () => {
  it('lê a view vw_execucoes_resumo_medico e mapeia para ExecucaoResumoMedico', async () => {
    const row = {
      medico_id: 'm1', cpf: '11111111111', nome: 'Dr. Teste',
      ultima_competencia: '2026-06', ultima_execucao_id: 'e1', ultima_execucao_status: 'concluido',
      ultimo_status_resultado: 'ok', ultimo_valor: 950.89, qtd_execucoes: 3,
    };
    const builder = makeBuilder({ data: [row], error: null });
    mockFrom.mockReturnValue(builder);

    const res = await listarResumoPorMedico();

    expect(mockFrom).toHaveBeenCalledWith('vw_execucoes_resumo_medico');
    expect(builder.order).toHaveBeenCalledWith('nome', { ascending: true });
    expect(res).toEqual([{
      medicoId: 'm1', cpf: '11111111111', nome: 'Dr. Teste',
      ultimaCompetencia: '2026-06', ultimaExecucaoId: 'e1', ultimaExecucaoStatus: 'concluido',
      ultimoStatusResultado: 'ok', ultimoValor: 950.89, qtdExecucoes: 3,
    }]);
  });

  it('propaga erro como ApiError', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: { message: 'boom' } }));
    await expect(listarResumoPorMedico()).rejects.toThrow('Falha ao listar resumo por médico');
  });
});

describe('historicoResultadosPorMedico', () => {
  it('filtra por medico_id quando informado', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    await historicoResultadosPorMedico({ medicoId: 'm1' });

    expect(builder.eq).toHaveBeenCalledWith('medico_id', 'm1');
    expect(builder.is).not.toHaveBeenCalled();
  });

  it('filtra por cpf + medico_id nulo quando não há medicoId', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    await historicoResultadosPorMedico({ cpf: '22222222222' });

    expect(builder.eq).toHaveBeenCalledWith('cpf', '22222222222');
    expect(builder.is).toHaveBeenCalledWith('medico_id', null);
  });

  it('mapeia o join com execucoes para ExecucaoHistoricoMedicoItem', async () => {
    const row = {
      execucao_id: 'e1', status: 'ok', total_valor: 950.89,
      execucoes: { competencia: '2026-06', status: 'concluido', iniciado_em: '2026-06-01T10:00:00Z' },
    };
    mockFrom.mockReturnValue(makeBuilder({ data: [row], error: null }));

    const res = await historicoResultadosPorMedico({ medicoId: 'm1' });

    expect(res).toEqual([{
      execucaoId: 'e1', competencia: '2026-06', execucaoStatus: 'concluido',
      statusResultado: 'ok', totalValor: 950.89, iniciadoEm: '2026-06-01T10:00:00Z',
      ehAdicional: false, // campo novo (Story 11.4/11.5) — médico não usa, default false
    }]);
  });

  it('propaga erro como ApiError (diferente de guiasExecucaoAnterior, que engole)', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: { message: 'boom' } }));
    await expect(historicoResultadosPorMedico({ medicoId: 'm1' })).rejects.toThrow(
      'Falha ao buscar histórico do médico',
    );
  });
});

describe('historicoResultadosPorClienteContabilidade (Story 11.5)', () => {
  it('filtra por cliente_contabilidade_id e mapeia eh_adicional', async () => {
    const rowMensal = {
      execucao_id: 'e1', status: 'ok', total_valor: 250,
      execucoes: { competencia: '2026-07', status: 'concluido', iniciado_em: '2026-07-24T00:00:00Z', eh_adicional: false },
    };
    const rowAdicional = {
      execucao_id: 'e2', status: 'ok', total_valor: 15000,
      execucoes: { competencia: '2026-07', status: 'concluido', iniciado_em: '2026-07-24T01:00:00Z', eh_adicional: true },
    };
    const builder = makeBuilder({ data: [rowAdicional, rowMensal], error: null });
    mockFrom.mockReturnValue(builder);

    const res = await historicoResultadosPorClienteContabilidade('cc-1');

    expect(builder.eq).toHaveBeenCalledWith('cliente_contabilidade_id', 'cc-1');
    expect(res).toEqual([
      { execucaoId: 'e2', competencia: '2026-07', execucaoStatus: 'concluido', statusResultado: 'ok', totalValor: 15000, iniciadoEm: '2026-07-24T01:00:00Z', ehAdicional: true },
      { execucaoId: 'e1', competencia: '2026-07', execucaoStatus: 'concluido', statusResultado: 'ok', totalValor: 250, iniciadoEm: '2026-07-24T00:00:00Z', ehAdicional: false },
    ]);
  });

  it('propaga erro como ApiError', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: { message: 'boom' } }));
    await expect(historicoResultadosPorClienteContabilidade('cc-1')).rejects.toThrow(
      'Falha ao buscar histórico do cliente contábil',
    );
  });
});
