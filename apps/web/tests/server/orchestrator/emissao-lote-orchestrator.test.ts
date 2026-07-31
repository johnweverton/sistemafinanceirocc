// Testes do orquestrador de lote de emissão (revisão de arquitetura 2026-07-31, decisão 5).
// Cobre: preview (classificação aceito/pulado, limites), e o circuit breaker do processamento
// (falha de item vs falha de gateway vs falha sistêmica — só as duas últimas contam pro
// breaker; sistêmica pausa imediato; 3 consecutivas OU taxa >20% pausam).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/lib/api-error';

const mockValidar = vi.fn();
const mockResolverGateway = vi.fn();
const mockEmitir = vi.fn();
vi.mock('@/server/emissao/emitir-boleto', () => ({
  validarResultadoParaEmissao: (...args: unknown[]) => mockValidar(...args),
  resolverGatewayOuFalhar: (...args: unknown[]) => mockResolverGateway(...args),
  emitirBoletoParaResultado: (...args: unknown[]) => mockEmitir(...args),
}));

const mockBuscarBoletoEmitido = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  buscarBoletoEmitido: (...args: unknown[]) => mockBuscarBoletoEmitido(...args),
}));

const mockListarResultadosOk = vi.fn();
const mockListarResultados = vi.fn();
vi.mock('@/server/repositories/execucao-repository', () => ({
  listarResultadosOkParaEmissao: (...args: unknown[]) => mockListarResultadosOk(...args),
  listarResultados: (...args: unknown[]) => mockListarResultados(...args),
}));

const mockCriarLoteComItens = vi.fn();
const mockBuscarLote = vi.fn();
const mockListarItensPendentes = vi.fn();
const mockContarItensPorStatus = vi.fn();
const mockAtualizarItemLote = vi.fn();
const mockAtualizarProgressoLote = vi.fn();
const mockPausarLotePorFalhas = vi.fn();
const mockConcluirLote = vi.fn();
const mockSomarValorEmitido = vi.fn();
vi.mock('@/server/repositories/lote-emissao-repository', () => ({
  criarLoteComItens: (...args: unknown[]) => mockCriarLoteComItens(...args),
  buscarLote: (...args: unknown[]) => mockBuscarLote(...args),
  listarItensPendentes: (...args: unknown[]) => mockListarItensPendentes(...args),
  contarItensPorStatus: (...args: unknown[]) => mockContarItensPorStatus(...args),
  atualizarItemLote: (...args: unknown[]) => mockAtualizarItemLote(...args),
  atualizarProgressoLote: (...args: unknown[]) => mockAtualizarProgressoLote(...args),
  pausarLotePorFalhas: (...args: unknown[]) => mockPausarLotePorFalhas(...args),
  concluirLote: (...args: unknown[]) => mockConcluirLote(...args),
  somarValorEmitido: (...args: unknown[]) => mockSomarValorEmitido(...args),
}));

const mockEnv = { INTERNAL_SECRET: 'segredo-bem-longo-o-suficiente-32-chars', APP_BASE_URL: 'http://localhost:3000' };
vi.mock('@/lib/env', () => ({
  getServerEnv: () => mockEnv,
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

function candidato(overrides: Partial<{ id: string; total_valor: number; medico_id: string | null }> = {}) {
  return {
    id: 'res-1',
    execucao_id: 'exec-1',
    medico_id: 'medico-1',
    cpf: '12345678901',
    nome: 'Dr. Teste',
    status: 'ok',
    total_valor: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true });
});

describe('calcularProgressoLote', () => {
  it('100% quando não há pendentes', async () => {
    const { calcularProgressoLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    expect(calcularProgressoLote(0, 10)).toBe(100);
  });

  it('0% quando nenhum item foi processado ainda', async () => {
    const { calcularProgressoLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    expect(calcularProgressoLote(10, 10)).toBe(0);
  });

  it('arredonda a fração processada', async () => {
    const { calcularProgressoLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    expect(calcularProgressoLote(1, 3)).toBe(67); // (3-1)/3 = 66.67% → 67
  });

  it('100% quando totalAceitos é zero (evita divisão por zero)', async () => {
    const { calcularProgressoLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    expect(calcularProgressoLote(0, 0)).toBe(100);
  });
});

describe('montarPreviewLote', () => {
  it('lança SEM_CANDIDATOS quando a execução não tem resultado "ok"', async () => {
    mockListarResultadosOk.mockResolvedValue([]);
    const { montarPreviewLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await expect(montarPreviewLote({ execucaoId: 'exec-1', criadoPor: 'admin-1' })).rejects.toMatchObject({
      code: 'SEM_CANDIDATOS',
    });
  });

  it('lança LOTE_MUITO_GRANDE acima do limite de itens', async () => {
    mockListarResultadosOk.mockResolvedValue(Array.from({ length: 201 }, (_, i) => candidato({ id: `res-${i}` })));
    const { montarPreviewLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await expect(montarPreviewLote({ execucaoId: 'exec-1', criadoPor: 'admin-1' })).rejects.toMatchObject({
      code: 'LOTE_MUITO_GRANDE',
    });
  });

  it('exclui candidatos que já têm boleto ativo (idempotência) — nem aparecem como pulado', async () => {
    mockListarResultadosOk.mockResolvedValue([candidato({ id: 'res-1' }), candidato({ id: 'res-2' })]);
    mockBuscarBoletoEmitido.mockImplementation((id: string) => Promise.resolve(id === 'res-1' ? { id: 'boleto-x' } : null));
    mockValidar.mockResolvedValue({ contaEmissora: 'mc' });
    mockResolverGateway.mockReturnValue({ gateway: {}, nomeGateway: 'mock' });
    mockCriarLoteComItens.mockResolvedValue({ id: 'lote-1' });

    const { montarPreviewLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await montarPreviewLote({ execucaoId: 'exec-1', criadoPor: 'admin-1' });

    const chamada = mockCriarLoteComItens.mock.calls[0]![0];
    expect(chamada.itens).toHaveLength(1);
    expect(chamada.itens[0].execucaoResultadoId).toBe('res-2');
    expect(chamada.snapshotTotalItens).toBe(1);
  });

  it('marca como pulado (com código do erro) um candidato que falha na validação de pagador', async () => {
    mockListarResultadosOk.mockResolvedValue([candidato({ id: 'res-1' })]);
    mockBuscarBoletoEmitido.mockResolvedValue(null);
    mockValidar.mockRejectedValue(new ApiError(422, 'Cobrança incompleta', 'COBRANCA_INCOMPLETA'));
    mockCriarLoteComItens.mockResolvedValue({ id: 'lote-1' });

    const { montarPreviewLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await expect(montarPreviewLote({ execucaoId: 'exec-1', criadoPor: 'admin-1' })).rejects.toMatchObject({
      code: 'SEM_ITENS_ELEGIVEIS',
    });

    // Mesmo lançando no final (nenhum item aceito), o item recusado foi classificado certo —
    // verificamos via um segundo candidato aceito na mesma chamada (abaixo) para confirmar a
    // forma da entrada 'pulado'.
  });

  it('marca como pulado um candidato com conta emissora sem credenciais, e segue os demais', async () => {
    mockListarResultadosOk.mockResolvedValue([candidato({ id: 'res-1' }), candidato({ id: 'res-2' })]);
    mockBuscarBoletoEmitido.mockResolvedValue(null);
    mockValidar.mockResolvedValue({ contaEmissora: 'cavalcante_viana' });
    mockResolverGateway.mockImplementation(() => {
      throw new ApiError(503, 'Conta sem credenciais', 'CONTA_NAO_CONFIGURADA');
    });
    mockCriarLoteComItens.mockResolvedValue({ id: 'lote-1' });

    const { montarPreviewLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await expect(montarPreviewLote({ execucaoId: 'exec-1', criadoPor: 'admin-1' })).rejects.toMatchObject({
      code: 'SEM_ITENS_ELEGIVEIS',
    });
  });

  it('happy path: mistura aceitos e pulados, soma valor só dos aceitos', async () => {
    mockListarResultadosOk.mockResolvedValue([
      candidato({ id: 'res-1', total_valor: 100 }),
      candidato({ id: 'res-2', total_valor: 200 }),
    ]);
    mockBuscarBoletoEmitido.mockResolvedValue(null);
    mockValidar.mockImplementation((c: { id: string }) =>
      c.id === 'res-1'
        ? Promise.resolve({ contaEmissora: 'mc' })
        : Promise.reject(new ApiError(422, 'Sem dados', 'COBRANCA_INCOMPLETA')),
    );
    mockResolverGateway.mockReturnValue({ gateway: {}, nomeGateway: 'mock' });
    mockCriarLoteComItens.mockResolvedValue({ id: 'lote-1' });

    const { montarPreviewLote } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await montarPreviewLote({ execucaoId: 'exec-1', criadoPor: 'admin-1' });

    const chamada = mockCriarLoteComItens.mock.calls[0]![0];
    expect(chamada.snapshotTotalItens).toBe(1);
    expect(chamada.snapshotTotalValor).toBe(100);
    expect(chamada.itens).toHaveLength(2);
    const pulado = chamada.itens.find((i: any) => i.execucaoResultadoId === 'res-2');
    expect(pulado.status).toBe('pulado');
    expect(pulado.codigoErro).toBe('COBRANCA_INCOMPLETA');
    const aceito = chamada.itens.find((i: any) => i.execucaoResultadoId === 'res-1');
    expect(aceito.status).toBe('pendente');
    expect(aceito.contaEmissora).toBe('mc');
  });
});

function loteBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lote-1',
    status: 'processando',
    confirmadoPor: 'admin-1',
    falhasConsecutivas: 0,
    snapshotTotalItens: 10,
    ...overrides,
  };
}

function itemPendente(id: string) {
  return { id, loteId: 'lote-1', execucaoResultadoId: `res-${id}` };
}

describe('processarProximoLoteEmissao', () => {
  it('não faz nada se o lote não está processando (já pausado/concluído por outra invocação)', async () => {
    mockBuscarLote.mockResolvedValue(loteBase({ status: 'concluido' }));
    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');
    expect(mockListarItensPendentes).not.toHaveBeenCalled();
  });

  it('conclui o lote quando não há mais itens pendentes', async () => {
    mockBuscarLote.mockResolvedValue(loteBase());
    mockListarItensPendentes.mockResolvedValue([]);
    mockContarItensPorStatus.mockResolvedValue({ pendente: 0, emitido: 8, pulado: 2, falhaGateway: 0, falhaOutra: 0 });
    mockSomarValorEmitido.mockResolvedValue(800);

    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');

    expect(mockConcluirLote).toHaveBeenCalledWith('lote-1', {
      totalEmitidos: 8,
      totalPulados: 2,
      totalFalhas: 0,
      totalValorEmitido: 800,
    });
  });

  it('emite com sucesso, atualiza progresso e encadeia o próximo lote quando ainda há pendentes', async () => {
    mockBuscarLote.mockResolvedValue(loteBase());
    mockListarItensPendentes.mockResolvedValue([itemPendente('i1')]);
    mockEmitir.mockResolvedValue({ tipo: 'emitido', boleto: { id: 'boleto-1' } });
    mockContarItensPorStatus.mockResolvedValue({ pendente: 5, emitido: 5, pulado: 0, falhaGateway: 0, falhaOutra: 0 });

    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');

    expect(mockAtualizarItemLote).toHaveBeenCalledWith('i1', { status: 'emitido', boletoId: 'boleto-1' });
    expect(mockAtualizarProgressoLote).toHaveBeenCalledWith('lote-1', expect.objectContaining({ falhasConsecutivas: 0 }));
    expect(mockPausarLotePorFalhas).not.toHaveBeenCalled();
    // Encadeia via HTTP interno (fire-and-forget) — verificamos que o fetch foi disparado.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('/api/boletos/lotes/lote-1/processar');
    expect(init).toEqual(
      expect.objectContaining({ method: 'POST', headers: { 'X-Internal-Secret': mockEnv.INTERNAL_SECRET } }),
    );
  });

  it('pausa IMEDIATAMENTE numa falha sistêmica (503), mesmo com só 1 item processado', async () => {
    mockBuscarLote.mockResolvedValue(loteBase());
    mockListarItensPendentes.mockResolvedValue([itemPendente('i1')]);
    mockEmitir.mockRejectedValue(new ApiError(503, 'Conta sem credenciais', 'CONTA_NAO_CONFIGURADA'));

    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');

    expect(mockAtualizarItemLote).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ status: 'falha', codigoErro: 'CONTA_NAO_CONFIGURADA' }),
    );
    expect(mockPausarLotePorFalhas).toHaveBeenCalledWith(
      'lote-1',
      expect.objectContaining({ motivoPausa: expect.stringContaining('sistêmica') }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockConcluirLote).not.toHaveBeenCalled();
  });

  it('pausa após 3 falhas de GATEWAY consecutivas', async () => {
    mockBuscarLote.mockResolvedValue(loteBase({ falhasConsecutivas: 2 })); // já vinha de outro lote com 2
    mockListarItensPendentes.mockResolvedValue([itemPendente('i1')]);
    mockEmitir.mockResolvedValue({ tipo: 'falha_gateway', boleto: { id: 'boleto-1' } });

    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');

    expect(mockPausarLotePorFalhas).toHaveBeenCalledWith(
      'lote-1',
      expect.objectContaining({ falhasConsecutivas: 3, motivoPausa: expect.stringContaining('consecutivas') }),
    );
  });

  it('falha de ITEM (dado de cadastro, ex. 422) não conta para o breaker — não pausa e não soma às consecutivas', async () => {
    mockBuscarLote.mockResolvedValue(loteBase({ falhasConsecutivas: 2 }));
    mockListarItensPendentes.mockResolvedValue([itemPendente('i1')]);
    mockEmitir.mockRejectedValue(new ApiError(422, 'Cobrança incompleta', 'COBRANCA_INCOMPLETA'));
    mockContarItensPorStatus.mockResolvedValue({ pendente: 3, emitido: 5, pulado: 1, falhaGateway: 0, falhaOutra: 1 });

    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');

    expect(mockAtualizarItemLote).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ status: 'falha', codigoErro: 'COBRANCA_INCOMPLETA' }),
    );
    expect(mockPausarLotePorFalhas).not.toHaveBeenCalled();
    // Consecutivas permanecem como estavam (2), não zeram nem incrementam.
    expect(mockAtualizarProgressoLote).toHaveBeenCalledWith('lote-1', expect.objectContaining({ falhasConsecutivas: 2 }));
  });

  it('BOLETO_JA_EMITIDO (409, corrida da reserva) é neutro — não pausa, marca pulado', async () => {
    mockBuscarLote.mockResolvedValue(loteBase());
    mockListarItensPendentes.mockResolvedValue([itemPendente('i1')]);
    mockEmitir.mockRejectedValue(new ApiError(409, 'Já existe boleto', 'BOLETO_JA_EMITIDO'));
    mockContarItensPorStatus.mockResolvedValue({ pendente: 0, emitido: 9, pulado: 1, falhaGateway: 0, falhaOutra: 0 });
    mockSomarValorEmitido.mockResolvedValue(900);

    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');

    expect(mockAtualizarItemLote).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ status: 'pulado', codigoErro: 'BOLETO_JA_EMITIDO' }),
    );
    expect(mockPausarLotePorFalhas).not.toHaveBeenCalled();
  });

  it('pausa quando a taxa de falha de gateway excede 20% com >= 10 tentativas', async () => {
    mockBuscarLote.mockResolvedValue(loteBase());
    mockListarItensPendentes.mockResolvedValue([itemPendente('i1')]);
    mockEmitir.mockResolvedValue({ tipo: 'falha_gateway', boleto: { id: 'boleto-1' } });
    // 3 falhas em 10 tentativas = 30% > 20%, mas ainda não bateu 3 CONSECUTIVAS nesta chamada
    // (só 1 item neste lote) — o gatilho aqui é a TAXA, não a sequência.
    mockContarItensPorStatus.mockResolvedValue({ pendente: 0, emitido: 7, pulado: 0, falhaGateway: 3, falhaOutra: 0 });

    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');

    expect(mockPausarLotePorFalhas).toHaveBeenCalledWith(
      'lote-1',
      expect.objectContaining({ motivoPausa: expect.stringContaining('Taxa de falha') }),
    );
  });

  it('NÃO pausa por taxa com menos de 10 tentativas, mesmo com falha', async () => {
    mockBuscarLote.mockResolvedValue(loteBase());
    mockListarItensPendentes.mockResolvedValue([itemPendente('i1')]);
    mockEmitir.mockResolvedValue({ tipo: 'falha_gateway', boleto: { id: 'boleto-1' } });
    mockContarItensPorStatus.mockResolvedValue({ pendente: 5, emitido: 3, pulado: 0, falhaGateway: 2, falhaOutra: 0 });

    const { processarProximoLoteEmissao } = await import('@/server/orchestrator/emissao-lote-orchestrator');
    await processarProximoLoteEmissao('lote-1');

    expect(mockPausarLotePorFalhas).not.toHaveBeenCalled();
  });
});
