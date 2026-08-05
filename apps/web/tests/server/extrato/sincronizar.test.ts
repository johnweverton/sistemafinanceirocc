// Testes da rota POST /api/extrato/sincronizar (Story 8.2, AC 2/5) — deps mockadas.
// Cobre: janela (primeira vez 90d / overlap 3d), 503 CONTA_NAO_CONFIGURADA, 502 do gateway,
// upsert + matching + log encadeados e resumo da resposta. O ENGINE é real (puro).
// EXTRATO_SYNC_HABILITADO forçada 'true' aqui (achado 2026-08-05: default de produção é
// 'false', a Cora cobra por chamada) — este arquivo testa a lógica do sync em si assumindo a
// flag ligada; o bloqueio pela flag desligada tem teste dedicado em
// extrato-sincronizar-route.test.ts.
process.env.EXTRATO_SYNC_HABILITADO = 'true';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockCriarContaGateway = vi.fn();
vi.mock('@/server/gateway/conta-gateway-factory', () => ({
  criarContaGateway: (...args: unknown[]) => mockCriarContaGateway(...args),
}));

const mockUpsertTransacoes = vi.fn();
const mockRegistrarSync = vi.fn();
const mockUltimoSync = vi.fn();
const mockListarCreditos = vi.fn();
const mockAplicarTransicoes = vi.fn();
const mockListarTransacoes = vi.fn();
const mockCategorizarTransacao = vi.fn();
vi.mock('@/server/repositories/extrato-repository', () => ({
  upsertTransacoes: (...a: unknown[]) => mockUpsertTransacoes(...a),
  registrarSync: (...a: unknown[]) => mockRegistrarSync(...a),
  ultimoSync: (...a: unknown[]) => mockUltimoSync(...a),
  listarCreditosParaMatching: (...a: unknown[]) => mockListarCreditos(...a),
  aplicarTransicoesConciliacao: (...a: unknown[]) => mockAplicarTransicoes(...a),
  listarTransacoes: (...a: unknown[]) => mockListarTransacoes(...a),
  categorizarTransacao: (...a: unknown[]) => mockCategorizarTransacao(...a),
}));

const mockListarBoletosPagos = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  listarBoletosPagosParaConciliacao: (...a: unknown[]) => mockListarBoletosPagos(...a),
}));

const mockBuscarCategoriasSistema = vi.fn();
const mockListarRegras = vi.fn();
vi.mock('@/server/repositories/plano-contas-repository', () => ({
  buscarCategoriasSistema: (...a: unknown[]) => mockBuscarCategoriasSistema(...a),
  listarRegras: (...a: unknown[]) => mockListarRegras(...a),
}));

import { POST } from '@/app/api/extrato/sincronizar/route';

const mockConsultarExtrato = vi.fn();
function gatewayOk() {
  mockCriarContaGateway.mockReturnValue({
    consultarExtrato: (...a: unknown[]) => mockConsultarExtrato(...a),
    consultarSaldo: vi.fn(),
  });
}

// userId único por chamada: o rate limiter (5/min) é estado de módulo e vazaria entre testes.
let seq = 0;
function reqSync(conta = 'mc', userId = `user-fin-${++seq}`) {
  mockRequireRole.mockResolvedValue({ userId, papel: 'financeiro' });
  const req = new Request('http://test/api/extrato/sincronizar', {
    method: 'POST',
    body: JSON.stringify({ conta }),
  });
  return POST(req, { params: {} as Record<string, never> });
}

/** Crédito persistido no shape do domínio (retorno de listarCreditosParaMatching). */
function creditoPersistido(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contaEmissora: 'mc',
    entryId: `e-${id}`,
    tipo: 'CREDIT',
    transactionType: 'PAYMENT',
    valor: 1500,
    descricao: null,
    contraparteNome: 'Dr. Teste',
    contraparteDocumento: '12345678901',
    dataTransacao: '2026-07-08T10:00:00Z',
    statusConciliacao: 'sem_match',
    boletoId: null,
    conciliadoPor: null,
    conciliadoEm: null,
    payload: {},
    sincronizadoEm: '2026-07-10T00:00:00Z',
    categoriaId: null,
    statusCategorizacao: 'sem_categoria',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mockUltimoSync.mockResolvedValue(null);
  mockUpsertTransacoes.mockResolvedValue({ qtdNovas: 0, qtdAtualizadas: 0 });
  mockListarCreditos.mockResolvedValue([]);
  mockListarBoletosPagos.mockResolvedValue([]);
  mockAplicarTransicoes.mockResolvedValue({ aplicadas: 0, descartadas: 0 });
  mockRegistrarSync.mockResolvedValue(undefined);
  mockBuscarCategoriasSistema.mockResolvedValue({
    receitaHonorariosId: 'cat-receita',
    tarifasBancariasId: 'cat-tarifa',
  });
  mockListarRegras.mockResolvedValue([]);
  mockListarTransacoes.mockResolvedValue([]);
  mockCategorizarTransacao.mockResolvedValue(undefined);
});

describe('POST /api/extrato/sincronizar — janela', () => {
  it('primeira sincronização → janela de 90 dias até hoje', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T15:00:00Z'));
    gatewayOk();
    mockConsultarExtrato.mockResolvedValue({ sucesso: true, transacoes: [] });

    const res = await reqSync('mc');
    expect(res.status).toBe(200);
    expect(mockConsultarExtrato).toHaveBeenCalledWith({ inicio: '2026-04-11', fim: '2026-07-10' });
    vi.useRealTimers();
  });

  it('com sync anterior → começa 3 dias antes do fim do último (overlap, D3)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T15:00:00Z'));
    mockUltimoSync.mockResolvedValue({
      id: 's1', contaEmissora: 'mc', periodoInicio: '2026-06-01', periodoFim: '2026-07-05',
      qtdNovas: 10, qtdAtualizadas: 0, executadoPor: 'u1', executadoEm: '2026-07-05T12:00:00Z',
    });
    gatewayOk();
    mockConsultarExtrato.mockResolvedValue({ sucesso: true, transacoes: [] });

    await reqSync('mc');
    expect(mockConsultarExtrato).toHaveBeenCalledWith({ inicio: '2026-07-02', fim: '2026-07-10' });
    vi.useRealTimers();
  });
});

describe('POST /api/extrato/sincronizar — erros', () => {
  it('conta inválida → 400 VALIDATION', async () => {
    const res = await reqSync('conta-x');
    expect(res.status).toBe(400);
    expect(mockCriarContaGateway).not.toHaveBeenCalled();
  });

  it('conta sem credenciais → 503 CONTA_NAO_CONFIGURADA (padrão 7.3)', async () => {
    mockCriarContaGateway.mockImplementation(() => {
      throw new Error("Credenciais da conta emissora 'cavalcante_viana' não configuradas.");
    });
    const res = await reqSync('cavalcante_viana');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('CONTA_NAO_CONFIGURADA');
    expect(body.error.message).toMatch(/cavalcante_viana/);
    expect(mockUpsertTransacoes).not.toHaveBeenCalled();
  });

  it('gateway falha (sucesso=false) → 502 SYNC_FALHOU sem gravar nada', async () => {
    gatewayOk();
    mockConsultarExtrato.mockResolvedValue({ sucesso: false, erro: 'HTTP 500 na página 1' });

    const res = await reqSync('mc');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('SYNC_FALHOU');
    expect(mockUpsertTransacoes).not.toHaveBeenCalled();
    expect(mockRegistrarSync).not.toHaveBeenCalled();
  });
});

describe('POST /api/extrato/sincronizar — fluxo feliz', () => {
  it('upsert → matching (engine real) → aplica transições → registra sync → resumo', async () => {
    gatewayOk();
    const transacoesApi = [{ entryId: 'e1' }, { entryId: 'e2' }];
    mockConsultarExtrato.mockResolvedValue({ sucesso: true, transacoes: transacoesApi });
    mockUpsertTransacoes.mockResolvedValue({ qtdNovas: 2, qtdAtualizadas: 0 });
    // 1 crédito casa com 1 boleto pago (documento idêntico → auto).
    mockListarCreditos.mockResolvedValue([creditoPersistido('t1')]);
    mockListarBoletosPagos.mockResolvedValue([
      { boletoId: 'b1', valorPago: 1500, pagoEm: '2026-07-08T09:00:00Z', pagadorDocumento: '12345678901' },
    ]);
    mockAplicarTransicoes.mockResolvedValue({ aplicadas: 1, descartadas: 0 });

    const res = await reqSync('mc', 'user-fin');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockUpsertTransacoes).toHaveBeenCalledWith('mc', transacoesApi);
    // Transição auto proposta pelo engine chegou na aplicação.
    expect(mockAplicarTransicoes).toHaveBeenCalledWith([
      { transacaoId: 't1', status: 'conciliado_auto', boletoId: 'b1' },
    ]);
    // Log do sync com o executor.
    expect(mockRegistrarSync).toHaveBeenCalledWith(
      'mc',
      expect.objectContaining({ inicio: expect.any(String), fim: expect.any(String) }),
      { qtdNovas: 2, qtdAtualizadas: 0 },
      'user-fin',
    );
    expect(body.transacoes).toEqual({ novas: 2, atualizadas: 0 });
    expect(body.conciliacao).toMatchObject({ autoConciliadas: 1, transicoesAplicadas: 1 });
  });

  it('transição igual ao estado atual NÃO vira update (só mudanças são aplicadas)', async () => {
    gatewayOk();
    mockConsultarExtrato.mockResolvedValue({ sucesso: true, transacoes: [] });
    // Crédito já 'sugerido' apontando b1; engine recalcula o MESMO resultado → nada a aplicar.
    mockListarCreditos.mockResolvedValue([
      creditoPersistido('t1', {
        statusConciliacao: 'sugerido',
        boletoId: 'b1',
        contraparteDocumento: null,
      }),
    ]);
    mockListarBoletosPagos.mockResolvedValue([
      { boletoId: 'b1', valorPago: 1500, pagoEm: '2026-07-08T09:00:00Z', pagadorDocumento: '99988877766' },
    ]);

    await reqSync('mc');
    expect(mockAplicarTransicoes).toHaveBeenCalledWith([]);
  });

  it('re-sync não regride: engine devolve sem_match para sugerido cujo boleto sumiu → transição aplicada', async () => {
    gatewayOk();
    mockConsultarExtrato.mockResolvedValue({ sucesso: true, transacoes: [] });
    // Sugestão órfã (boleto foi conciliado com outra transação e saiu da lista de livres).
    mockListarCreditos.mockResolvedValue([
      creditoPersistido('t1', { statusConciliacao: 'sugerido', boletoId: 'b-antigo' }),
    ]);
    mockListarBoletosPagos.mockResolvedValue([]);

    await reqSync('mc');
    expect(mockAplicarTransicoes).toHaveBeenCalledWith([
      { transacaoId: 't1', status: 'sem_match', boletoId: null },
    ]);
  });
});

describe('POST /api/extrato/sincronizar — categorização (Story 9.2, AC 2)', () => {
  it('categoriza (engine real) as pendentes sem_categoria da conta e persiste, incluindo o resumo na resposta', async () => {
    gatewayOk();
    mockConsultarExtrato.mockResolvedValue({ sucesso: true, transacoes: [] });
    mockListarTransacoes.mockResolvedValue([
      creditoPersistido('t-conciliado', { statusConciliacao: 'conciliado_auto' }),
      creditoPersistido('t-tarifa', { tipo: 'DEBIT', transactionType: 'FEE', statusConciliacao: 'sem_match' }),
      creditoPersistido('t-sem-match', { statusConciliacao: 'sem_match' }),
    ]);

    const res = await reqSync('mc');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockListarTransacoes).toHaveBeenCalledWith({
      contaEmissora: 'mc',
      statusCategorizacao: 'sem_categoria',
    });
    expect(mockCategorizarTransacao).toHaveBeenCalledWith('t-conciliado', {
      categoriaId: 'cat-receita',
      status: 'confirmada',
    });
    expect(mockCategorizarTransacao).toHaveBeenCalledWith('t-tarifa', {
      categoriaId: 'cat-tarifa',
      status: 'confirmada',
    });
    // t-sem-match não bateu em nenhuma regra → não chama categorizarTransacao para ela.
    expect(mockCategorizarTransacao).toHaveBeenCalledTimes(2);
    expect(body.categorizacao).toEqual({ confirmadas: 2, sugeridas: 0, semCategoria: 1 });
  });

  it('usa as regras ativas do usuário quando as auto-regras de sistema não batem', async () => {
    gatewayOk();
    mockConsultarExtrato.mockResolvedValue({ sucesso: true, transacoes: [] });
    mockListarTransacoes.mockResolvedValue([
      creditoPersistido('t1', {
        tipo: 'DEBIT',
        transactionType: 'TRANSFER',
        descricao: 'Aluguel do escritório',
        statusConciliacao: 'sem_match',
      }),
    ]);
    mockListarRegras.mockResolvedValue([
      { id: 'r1', categoriaId: 'cat-aluguel', campo: 'descricao', padrao: 'aluguel', prioridade: 0, ativo: true, criadoEm: '2026-07-11T00:00:00Z' },
    ]);

    const res = await reqSync('mc');
    const body = await res.json();

    expect(mockCategorizarTransacao).toHaveBeenCalledWith('t1', { categoriaId: 'cat-aluguel', status: 'sugerida' });
    expect(body.categorizacao).toEqual({ confirmadas: 0, sugeridas: 1, semCategoria: 0 });
  });

  it('sem pendentes → não chama categorizarTransacao', async () => {
    gatewayOk();
    mockConsultarExtrato.mockResolvedValue({ sucesso: true, transacoes: [] });
    mockListarTransacoes.mockResolvedValue([]);

    await reqSync('mc');
    expect(mockCategorizarTransacao).not.toHaveBeenCalled();
  });
});
