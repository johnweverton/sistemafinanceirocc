// Testes da rota GET /api/cron/relatorio-mensal (feedback do dono, 2026-08-17): dispara pelo
// Vercel Cron, sem sessão de usuário — autenticação é só o segredo CRON_SECRET. Destinatários e
// dia de envio vêm de config_relatorio_mensal (editável em Configurações); com a linha ainda no
// estado seed (nunca configurada pela tela), cai no fallback legado RELATORIO_MENSAL_EMAILS + dia 1.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockEnv: { CRON_SECRET?: string; RELATORIO_MENSAL_EMAILS?: string } = {
  CRON_SECRET: 'segredo-com-mais-de-16-chars',
  RELATORIO_MENSAL_EMAILS: 'ceo@empresa.com, financeiro@empresa.com',
};
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

const mockLerConfig = vi.fn();
vi.mock('@/server/repositories/config-relatorio-mensal-repository', () => ({
  lerConfig: (...a: unknown[]) => mockLerConfig(...a),
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

const CONFIG_NUNCA_TOCADA = { emails: '', diaEnvio: 1, habilitado: false };

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
  mockLerConfig.mockResolvedValue(CONFIG_NUNCA_TOCADA);
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
    mockEnv.CRON_SECRET = undefined;
    const res = await req('segredo-com-mais-de-16-chars');
    expect(res.status).toBe(401);
  });

  it('config nunca tocada + RELATORIO_MENSAL_EMAILS vazio → pula o envio sem erro', async () => {
    mockEnv.RELATORIO_MENSAL_EMAILS = '';
    const res = await req('segredo-com-mais-de-16-chars');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ enviado: false, competencia: '2026-08' });
    expect(mockListarRecebiveis).not.toHaveBeenCalled();
    expect(mockEnviarRelatorioMensal).not.toHaveBeenCalled();
  });

  it('config nunca tocada (fallback env var, dia 1) + hoje é dia 1 → envia', async () => {
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

  it('config configurada pela tela com habilitado=false → pula o envio, ignora RELATORIO_MENSAL_EMAILS', async () => {
    mockLerConfig.mockResolvedValue({ emails: 'ceo@empresa.com', diaEnvio: 1, habilitado: false });
    const res = await req('segredo-com-mais-de-16-chars');
    const body = await res.json();
    expect(body).toMatchObject({ enviado: false, motivo: 'Envio desabilitado' });
    expect(mockEnviarRelatorioMensal).not.toHaveBeenCalled();
  });

  it('config habilitada, hoje NÃO é o dia configurado → pula o envio sem erro', async () => {
    mockLerConfig.mockResolvedValue({ emails: 'ceo@empresa.com', diaEnvio: 5, habilitado: true });
    const res = await req('segredo-com-mais-de-16-chars'); // sistema em 2026-09-01
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enviado).toBe(false);
    expect(body.motivo).toMatch(/dia 5/);
    expect(mockEnviarRelatorioMensal).not.toHaveBeenCalled();
  });

  it('config habilitada, hoje É o dia configurado → envia para os e-mails da config, não do env var', async () => {
    mockLerConfig.mockResolvedValue({ emails: 'nova-ceo@empresa.com', diaEnvio: 1, habilitado: true });
    const res = await req('segredo-com-mais-de-16-chars');
    expect(res.status).toBe(200);
    expect(mockEnviarRelatorioMensal).toHaveBeenCalledTimes(1);
    const [destinatarios] = mockEnviarRelatorioMensal.mock.calls[0]!;
    expect(destinatarios).toEqual(['nova-ceo@empresa.com']);
  });
});
