// Testes da rota GET /api/cron/relatorio-mensal (feedback do dono, 2026-08-17): dispara pelo
// Vercel Cron, sem sessão de usuário — autenticação é só o segredo CRON_SECRET.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockEnv = {
  CRON_SECRET: 'segredo-com-mais-de-16-chars',
  RELATORIO_MENSAL_EMAILS: 'ceo@empresa.com, financeiro@empresa.com',
};
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

const mockListarRecebiveis = vi.fn();
vi.mock('@/server/repositories/recebiveis-repository', () => ({
  listarRecebiveis: (...a: unknown[]) => mockListarRecebiveis(...a),
}));

const mockEnviarRelatorioMensal = vi.fn().mockResolvedValue(undefined);
vi.mock('@/server/gateway/email-gateway', () => ({
  EmailGateway: vi.fn().mockImplementation(() => ({
    enviarRelatorioMensal: (...a: unknown[]) => mockEnviarRelatorioMensal(...a),
  })),
}));

import { GET } from '@/app/api/cron/relatorio-mensal/route';

function req(bearer?: string) {
  const headers = new Headers();
  if (bearer !== undefined) headers.set('authorization', `Bearer ${bearer}`);
  return GET(new Request('http://test/api/cron/relatorio-mensal', { headers }), {
    params: {} as Record<string, never>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.CRON_SECRET = 'segredo-com-mais-de-16-chars';
  mockEnv.RELATORIO_MENSAL_EMAILS = 'ceo@empresa.com, financeiro@empresa.com';
  mockListarRecebiveis.mockResolvedValue([]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T12:00:00Z')); // dia 1 → competência anterior = 2026-08
});

afterEach(() => vi.useRealTimers());

describe('GET /api/cron/relatorio-mensal', () => {
  it('sem Authorization → 401', async () => {
    const res = await req(undefined);
    expect(res.status).toBe(401);
    expect(mockListarRecebiveis).not.toHaveBeenCalled();
  });

  it('secret errado → 401', async () => {
    const res = await req('segredo-errado-qualquer-coisa');
    expect(res.status).toBe(401);
    expect(mockListarRecebiveis).not.toHaveBeenCalled();
  });

  it('CRON_SECRET não configurado no ambiente → sempre 401, mesmo com bearer correto', async () => {
    (mockEnv as { CRON_SECRET?: string }).CRON_SECRET = undefined;
    const res = await req('segredo-com-mais-de-16-chars');
    expect(res.status).toBe(401);
  });

  it('RELATORIO_MENSAL_EMAILS vazio → pula o envio sem erro, competência calculada corretamente', async () => {
    mockEnv.RELATORIO_MENSAL_EMAILS = '';
    const res = await req('segredo-com-mais-de-16-chars');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ enviado: false, competencia: '2026-08' });
    expect(mockListarRecebiveis).not.toHaveBeenCalled();
    expect(mockEnviarRelatorioMensal).not.toHaveBeenCalled();
  });

  it('secret correto + destinatários configurados → gera PDF do mês ANTERIOR e envia por e-mail', async () => {
    mockListarRecebiveis.mockResolvedValue([
      {
        boletoId: 'b1', execucaoResultadoId: 'e1', idExterno: null, competencia: '2026-08',
        medicoId: 'm1', nome: 'Dr. Alfa', valor: 1000, vencimento: '2026-08-10', pagoEm: '2026-08-09',
        valorPago: 1000, emitidoEm: '2026-08-01T00:00:00Z', contaEmissora: 'mc', statusDerivado: 'pago',
      },
    ]);

    const res = await req('segredo-com-mais-de-16-chars');

    expect(mockListarRecebiveis).toHaveBeenCalledWith({ competencia: '2026-08' });
    expect(mockEnviarRelatorioMensal).toHaveBeenCalledTimes(1);
    const [destinatarios, competencia, pdfBuffer] = mockEnviarRelatorioMensal.mock.calls[0]!;
    expect(destinatarios).toEqual(['ceo@empresa.com', 'financeiro@empresa.com']);
    expect(competencia).toBe('2026-08');
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enviado).toBe(true);
    expect(body.competencia).toBe('2026-08');
    expect(body.destinatarios).toBe(2);
  });
});
