// Testes das rotas de emissão em lote (revisão de arquitetura 2026-07-31, decisão 5) — foco nos
// requisitos de segurança: feature flags, papel exigido em cada etapa, segredo interno da rota
// de processamento, revalidação de snapshot e expiração na confirmação.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = {
  GATEWAY_EMISSAO_HABILITADA: 'true',
  EMISSAO_LOTE_HABILITADA: 'true',
  INTERNAL_SECRET: 'segredo-bem-longo-o-suficiente-32-chars-ok',
};
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({ ...mockEnv }),
}));

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockMontarPreviewLote = vi.fn();
const mockDispararProcessamento = vi.fn();
vi.mock('@/server/orchestrator/emissao-lote-orchestrator', () => ({
  montarPreviewLote: (...args: unknown[]) => mockMontarPreviewLote(...args),
  dispararProcessamentoLoteEmissao: (...args: unknown[]) => mockDispararProcessamento(...args),
}));

const mockListarItensLote = vi.fn();
const mockBuscarLote = vi.fn();
const mockConfirmarLote = vi.fn();
const mockExpirarLote = vi.fn();
const mockRetomarLote = vi.fn();
const mockResetarItemParaPendente = vi.fn();
const mockReabrirLoteParaProcessamento = vi.fn();
vi.mock('@/server/repositories/lote-emissao-repository', () => ({
  listarItensLote: (...args: unknown[]) => mockListarItensLote(...args),
  buscarLote: (...args: unknown[]) => mockBuscarLote(...args),
  confirmarLote: (...args: unknown[]) => mockConfirmarLote(...args),
  expirarLote: (...args: unknown[]) => mockExpirarLote(...args),
  retomarLote: (...args: unknown[]) => mockRetomarLote(...args),
  resetarItemParaPendente: (...args: unknown[]) => mockResetarItemParaPendente(...args),
  reabrirLoteParaProcessamento: (...args: unknown[]) => mockReabrirLoteParaProcessamento(...args),
}));

const mockListarResultados = vi.fn();
vi.mock('@/server/repositories/execucao-repository', () => ({
  listarResultados: (...args: unknown[]) => mockListarResultados(...args),
}));

function req(url: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.GATEWAY_EMISSAO_HABILITADA = 'true';
  mockEnv.EMISSAO_LOTE_HABILITADA = 'true';
  mockRequireRole.mockResolvedValue({ userId: 'admin-1', papel: 'admin', colaboradorResponsavel: null });
});

describe('POST /api/boletos/lotes (preview)', () => {
  // userId único por teste: o rate limiter (3/hora) é estado de módulo por usuário — reutilizar
  // o mesmo userId estouraria o limite conforme o arquivo ganha testes (mesmo cuidado já
  // documentado em boleto-emissao.test.ts).
  it('403 quando GATEWAY_EMISSAO_HABILITADA está desligada', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-preview-1', papel: 'admin', colaboradorResponsavel: null });
    mockEnv.GATEWAY_EMISSAO_HABILITADA = 'false';
    const { POST } = await import('@/app/api/boletos/lotes/route');
    const resp = await POST(
      req('http://x/api/boletos/lotes', { execucaoId: '00000000-0000-0000-0000-000000000001' }),
      { params: {} },
    );
    expect(resp.status).toBe(403);
    expect((await resp.json()).error.code).toBe('EMISSAO_DESABILITADA');
    expect(mockMontarPreviewLote).not.toHaveBeenCalled();
  });

  it('403 quando EMISSAO_LOTE_HABILITADA está desligada (independente da flag mestre)', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-preview-2', papel: 'admin', colaboradorResponsavel: null });
    mockEnv.EMISSAO_LOTE_HABILITADA = 'false';
    const { POST } = await import('@/app/api/boletos/lotes/route');
    const resp = await POST(
      req('http://x/api/boletos/lotes', { execucaoId: '00000000-0000-0000-0000-000000000001' }),
      { params: {} },
    );
    expect(resp.status).toBe(403);
    expect((await resp.json()).error.code).toBe('LOTE_DESABILITADO');
  });

  it('422 com payload inválido (execucaoId ausente)', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-preview-3', papel: 'admin', colaboradorResponsavel: null });
    const { POST } = await import('@/app/api/boletos/lotes/route');
    const resp = await POST(req('http://x/api/boletos/lotes', {}), { params: {} });
    expect(resp.status).toBe(422);
    expect(mockMontarPreviewLote).not.toHaveBeenCalled();
  });

  it('happy path: monta o preview e devolve lote + itens + quebra por conta emissora', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-preview-4', papel: 'admin', colaboradorResponsavel: null });
    mockMontarPreviewLote.mockResolvedValue({ id: 'lote-1', snapshotTotalItens: 1, snapshotTotalValor: 100 });
    mockListarItensLote.mockResolvedValue([
      { id: 'item-1', execucaoResultadoId: 'res-1', status: 'pendente', contaEmissora: 'mc', valorSnapshot: 100 },
    ]);
    mockListarResultados.mockResolvedValue([{ id: 'res-1', nome: 'Dr. Teste' }]);

    const { POST } = await import('@/app/api/boletos/lotes/route');
    const resp = await POST(
      req('http://x/api/boletos/lotes', { execucaoId: '00000000-0000-0000-0000-000000000001' }),
      { params: {} },
    );

    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body.lote.id).toBe('lote-1');
    expect(body.itens[0].nome).toBe('Dr. Teste');
    expect(body.porContaEmissora).toEqual([{ contaEmissora: 'mc', itens: 1, valor: 100 }]);
  });
});

describe('POST /api/boletos/lotes/[id]/confirmar', () => {
  // userId único por teste — mesmo cuidado do bloco de preview acima (rate limiter 3/hora).
  it('exige papel admin (não financeiro) — requireRole é chamado só com admin', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-confirmar-1', papel: 'admin', colaboradorResponsavel: null });
    const { POST } = await import('@/app/api/boletos/lotes/[id]/confirmar/route');
    mockBuscarLote.mockResolvedValue(null);
    await POST(req('http://x', { totalItens: 1, totalValor: 100 }), { params: { id: 'lote-1' } });
    expect(mockRequireRole).toHaveBeenCalledWith(['admin']);
  });

  it('404 quando o lote não existe', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-confirmar-2', papel: 'admin', colaboradorResponsavel: null });
    mockBuscarLote.mockResolvedValue(null);
    const { POST } = await import('@/app/api/boletos/lotes/[id]/confirmar/route');
    const resp = await POST(req('http://x', { totalItens: 1, totalValor: 100 }), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(404);
  });

  it('409 quando o lote não está aguardando confirmação', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-confirmar-3', papel: 'admin', colaboradorResponsavel: null });
    mockBuscarLote.mockResolvedValue({ id: 'lote-1', status: 'processando', criadoEm: new Date().toISOString() });
    const { POST } = await import('@/app/api/boletos/lotes/[id]/confirmar/route');
    const resp = await POST(req('http://x', { totalItens: 1, totalValor: 100 }), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(409);
    expect((await resp.json()).error.code).toBe('LOTE_NAO_CONFIRMAVEL');
  });

  it('409 e expira o lote quando o preview tem mais de 30 minutos', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-confirmar-4', papel: 'admin', colaboradorResponsavel: null });
    const criadoEm = new Date(Date.now() - 31 * 60_000).toISOString();
    mockBuscarLote.mockResolvedValue({
      id: 'lote-1',
      status: 'aguardando_confirmacao',
      criadoEm,
      snapshotTotalItens: 1,
      snapshotTotalValor: 100,
    });
    const { POST } = await import('@/app/api/boletos/lotes/[id]/confirmar/route');
    const resp = await POST(req('http://x', { totalItens: 1, totalValor: 100 }), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(409);
    expect((await resp.json()).error.code).toBe('LOTE_EXPIRADO');
    expect(mockExpirarLote).toHaveBeenCalledWith('lote-1');
    expect(mockConfirmarLote).not.toHaveBeenCalled();
  });

  it('409 SNAPSHOT_DIVERGENTE quando o total enviado não bate com o gravado', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-confirmar-5', papel: 'admin', colaboradorResponsavel: null });
    mockBuscarLote.mockResolvedValue({
      id: 'lote-1',
      status: 'aguardando_confirmacao',
      criadoEm: new Date().toISOString(),
      snapshotTotalItens: 5,
      snapshotTotalValor: 500,
    });
    const { POST } = await import('@/app/api/boletos/lotes/[id]/confirmar/route');
    const resp = await POST(req('http://x', { totalItens: 4, totalValor: 500 }), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(409);
    expect((await resp.json()).error.code).toBe('SNAPSHOT_DIVERGENTE');
    expect(mockConfirmarLote).not.toHaveBeenCalled();
  });

  it('409 quando confirmarLote não encontra a transição (corrida — outra requisição já confirmou)', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-confirmar-6', papel: 'admin', colaboradorResponsavel: null });
    mockBuscarLote.mockResolvedValue({
      id: 'lote-1',
      status: 'aguardando_confirmacao',
      criadoEm: new Date().toISOString(),
      snapshotTotalItens: 1,
      snapshotTotalValor: 100,
    });
    mockConfirmarLote.mockResolvedValue(null);
    const { POST } = await import('@/app/api/boletos/lotes/[id]/confirmar/route');
    const resp = await POST(req('http://x', { totalItens: 1, totalValor: 100 }), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(409);
    expect(mockDispararProcessamento).not.toHaveBeenCalled();
  });

  it('happy path: confirma, dispara o processamento (fire-and-forget) e responde 202', async () => {
    mockRequireRole.mockResolvedValue({ userId: 'admin-confirmar-7', papel: 'admin', colaboradorResponsavel: null });
    mockBuscarLote.mockResolvedValue({
      id: 'lote-1',
      status: 'aguardando_confirmacao',
      criadoEm: new Date().toISOString(),
      snapshotTotalItens: 1,
      snapshotTotalValor: 100,
    });
    mockConfirmarLote.mockResolvedValue({ id: 'lote-1', status: 'processando' });
    const { POST } = await import('@/app/api/boletos/lotes/[id]/confirmar/route');
    const resp = await POST(req('http://x', { totalItens: 1, totalValor: 100 }), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(202);
    expect(mockConfirmarLote).toHaveBeenCalledWith('lote-1', 'admin-confirmar-7');
    expect(mockDispararProcessamento).toHaveBeenCalledWith('lote-1');
  });
});

describe('POST /api/boletos/lotes/[id]/retomar', () => {
  it('exige papel admin', async () => {
    mockRetomarLote.mockResolvedValue(null);
    const { POST } = await import('@/app/api/boletos/lotes/[id]/retomar/route');
    await POST(req('http://x'), { params: { id: 'lote-1' } });
    expect(mockRequireRole).toHaveBeenCalledWith(['admin']);
  });

  it('422 quando o lote não está pausado (retomarLote devolve null)', async () => {
    mockRetomarLote.mockResolvedValue(null);
    const { POST } = await import('@/app/api/boletos/lotes/[id]/retomar/route');
    const resp = await POST(req('http://x'), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(422);
    expect(mockDispararProcessamento).not.toHaveBeenCalled();
  });

  it('happy path: retoma e dispara o processamento', async () => {
    mockRetomarLote.mockResolvedValue({ id: 'lote-1', status: 'processando' });
    const { POST } = await import('@/app/api/boletos/lotes/[id]/retomar/route');
    const resp = await POST(req('http://x'), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(202);
    expect(mockDispararProcessamento).toHaveBeenCalledWith('lote-1');
  });
});

describe('POST /api/boletos/lotes/[id]/processar (interno)', () => {
  it('401 sem o segredo interno', async () => {
    const { POST } = await import('@/app/api/boletos/lotes/[id]/processar/route');
    const resp = await POST(new Request('http://x', { method: 'POST' }), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(401);
    expect(mockDispararProcessamento).not.toHaveBeenCalled();
  });

  it('401 com o segredo interno errado', async () => {
    const { POST } = await import('@/app/api/boletos/lotes/[id]/processar/route');
    const resp = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 'segredo-errado-mas-do-mesmo-tamanho!' } }),
      { params: { id: 'lote-1' } },
    );
    expect(resp.status).toBe(401);
  });

  it('200 com o segredo interno correto — processa o lote', async () => {
    const { POST } = await import('@/app/api/boletos/lotes/[id]/processar/route');
    const resp = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': mockEnv.INTERNAL_SECRET } }),
      { params: { id: 'lote-1' } },
    );
    expect(resp.status).toBe(200);
    expect(mockDispararProcessamento).toHaveBeenCalledWith('lote-1');
  });
});

describe('GET /api/boletos/lotes/[id]', () => {
  it('404 quando o lote não existe', async () => {
    mockBuscarLote.mockResolvedValue(null);
    const { GET } = await import('@/app/api/boletos/lotes/[id]/route');
    const resp = await GET(new Request('http://x'), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(404);
  });

  it('devolve lote + itens', async () => {
    mockBuscarLote.mockResolvedValue({ id: 'lote-1', status: 'concluido' });
    mockListarItensLote.mockResolvedValue([{ id: 'item-1' }]);
    const { GET } = await import('@/app/api/boletos/lotes/[id]/route');
    const resp = await GET(new Request('http://x'), { params: { id: 'lote-1' } });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.lote.id).toBe('lote-1');
    expect(body.itens).toHaveLength(1);
  });

  it('enriquece os itens com o nome do pagador (escopo execucao) — para a UI mostrar QUEM falhou', async () => {
    mockBuscarLote.mockResolvedValue({ id: 'lote-1', status: 'concluido', escopoTipo: 'execucao', escopoRef: 'exec-1' });
    mockListarItensLote.mockResolvedValue([
      { id: 'item-1', execucaoResultadoId: 'res-1', status: 'falha', codigoErro: 'FALHA_GATEWAY', mensagemErro: 'O gateway recusou.' },
    ]);
    mockListarResultados.mockResolvedValue([{ id: 'res-1', nome: 'Dr. Falhou' }]);
    const { GET } = await import('@/app/api/boletos/lotes/[id]/route');
    const resp = await GET(new Request('http://x'), { params: { id: 'lote-1' } });
    const body = await resp.json();
    expect(body.itens[0].nome).toBe('Dr. Falhou');
    expect(mockListarResultados).toHaveBeenCalledWith('exec-1');
  });
});

describe('POST /api/boletos/lotes/[id]/itens/[itemId]/reprocessar', () => {
  it('exige papel admin', async () => {
    mockBuscarLote.mockResolvedValue({ id: 'lote-1', status: 'concluido' });
    mockResetarItemParaPendente.mockResolvedValue(null);
    const { POST } = await import('@/app/api/boletos/lotes/[id]/itens/[itemId]/reprocessar/route');
    await POST(req('http://x'), { params: { id: 'lote-1', itemId: 'item-1' } });
    expect(mockRequireRole).toHaveBeenCalledWith(['admin']);
  });

  it('404 quando o lote não existe', async () => {
    mockBuscarLote.mockResolvedValue(null);
    const { POST } = await import('@/app/api/boletos/lotes/[id]/itens/[itemId]/reprocessar/route');
    const resp = await POST(req('http://x'), { params: { id: 'lote-1', itemId: 'item-1' } });
    expect(resp.status).toBe(404);
    expect(mockResetarItemParaPendente).not.toHaveBeenCalled();
  });

  it('422 quando o item não está com falha (resetarItemParaPendente devolve null)', async () => {
    mockBuscarLote.mockResolvedValue({ id: 'lote-1', status: 'concluido' });
    mockResetarItemParaPendente.mockResolvedValue(null);
    const { POST } = await import('@/app/api/boletos/lotes/[id]/itens/[itemId]/reprocessar/route');
    const resp = await POST(req('http://x'), { params: { id: 'lote-1', itemId: 'item-1' } });
    expect(resp.status).toBe(422);
    expect((await resp.json()).error.code).toBe('ITEM_NAO_REPROCESSAVEL');
    expect(mockDispararProcessamento).not.toHaveBeenCalled();
  });

  it('reabre um lote concluído para processando antes de reprocessar o item', async () => {
    mockBuscarLote.mockResolvedValue({ id: 'lote-1', status: 'concluido' });
    mockResetarItemParaPendente.mockResolvedValue({ id: 'item-1', status: 'pendente' });
    mockReabrirLoteParaProcessamento.mockResolvedValue({ id: 'lote-1', status: 'processando' });
    const { POST } = await import('@/app/api/boletos/lotes/[id]/itens/[itemId]/reprocessar/route');
    const resp = await POST(req('http://x'), { params: { id: 'lote-1', itemId: 'item-1' } });
    expect(resp.status).toBe(202);
    expect(mockReabrirLoteParaProcessamento).toHaveBeenCalledWith('lote-1');
    expect(mockDispararProcessamento).toHaveBeenCalledWith('lote-1');
  });

  it('não tenta reabrir um lote que já está processando', async () => {
    mockBuscarLote.mockResolvedValue({ id: 'lote-1', status: 'processando' });
    mockResetarItemParaPendente.mockResolvedValue({ id: 'item-1', status: 'pendente' });
    const { POST } = await import('@/app/api/boletos/lotes/[id]/itens/[itemId]/reprocessar/route');
    const resp = await POST(req('http://x'), { params: { id: 'lote-1', itemId: 'item-1' } });
    expect(resp.status).toBe(202);
    expect(mockReabrirLoteParaProcessamento).not.toHaveBeenCalled();
    expect(mockDispararProcessamento).toHaveBeenCalledWith('lote-1');
  });
});
