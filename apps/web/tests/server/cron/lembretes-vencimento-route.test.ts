// Testes da rota GET /api/cron/lembretes-vencimento (Épico 13, Fase 1): dispara pelo Vercel
// Cron, sem sessão de usuário — autenticação é só o segredo CRON_SECRET (mesmo padrão do cron de
// relatório mensal). Cobre: auth, toggle desabilitado, happy path (WhatsApp + e-mail), idempotência
// (já disparado), boleto sem contato e boleto sem PDF.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv: { CRON_SECRET?: string } = { CRON_SECRET: 'segredo-com-mais-de-16-chars' };
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

const mockLerConfigLembrete = vi.fn();
vi.mock('@/server/repositories/config-lembrete-vencimento-repository', () => ({
  lerConfig: (...a: unknown[]) => mockLerConfigLembrete(...a),
}));

const mockListarBoletosVencendoEm = vi.fn();
vi.mock('@/server/repositories/boleto-repository', () => ({
  listarBoletosVencendoEm: (...a: unknown[]) => mockListarBoletosVencendoEm(...a),
}));

const mockResolverPagadorDoResultado = vi.fn();
vi.mock('@/server/emissao/resolver-pagador', () => ({
  resolverPagadorDoResultado: (...a: unknown[]) => mockResolverPagadorDoResultado(...a),
}));

const mockJaDisparado = vi.fn();
const mockRegistrarDisparo = vi.fn();
vi.mock('@/server/repositories/boleto-disparo-repository', () => ({
  jaDisparado: (...a: unknown[]) => mockJaDisparado(...a),
  registrarDisparo: (...a: unknown[]) => mockRegistrarDisparo(...a),
}));

const mockEnviarDocumentoPorUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('@/server/gateway/zappy-gateway', () => ({
  ZappyGateway: vi.fn().mockImplementation(() => ({
    enviarDocumentoPorUrl: (...a: unknown[]) => mockEnviarDocumentoPorUrl(...a),
  })),
}));

const mockEnviarLembreteVencimento = vi.fn().mockResolvedValue(undefined);
vi.mock('@/server/gateway/email-gateway', () => ({
  EmailGateway: vi.fn().mockImplementation(() => ({
    enviarLembreteVencimento: (...a: unknown[]) => mockEnviarLembreteVencimento(...a),
  })),
}));

const mockSupabaseMaybeSingle = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockSupabaseMaybeSingle(),
        }),
      }),
    }),
  }),
}));

import { GET } from '@/app/api/cron/lembretes-vencimento/route';

const BOLETO_FIXTURE = {
  boletoId: 'boleto-1',
  execucaoResultadoId: 'resultado-1',
  vencimento: '2026-09-02',
  payloadResposta: { payment_options: { bank_slip: { url: 'https://cora.example/boleto.pdf' } } },
};

const PAGADOR_FIXTURE = {
  pagadorNomenclatura: 'médico' as const,
  cobranca: { pagadorTipo: 'PF', pagadorNome: 'Dr. Teste', whatsapp: '5585999999999', email: 'dr@teste.com' },
  condicoesPagador: null,
  contaEmissora: 'mc' as const,
};

function req(bearer?: string) {
  const headers = new Headers();
  if (bearer !== undefined) headers.set('authorization', `Bearer ${bearer}`);
  return GET(new Request('http://test/api/cron/lembretes-vencimento', { headers }), {
    params: {} as Record<string, never>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.CRON_SECRET = 'segredo-com-mais-de-16-chars';
  mockLerConfigLembrete.mockResolvedValue({ habilitado: true });
  mockListarBoletosVencendoEm.mockResolvedValue([]);
  mockSupabaseMaybeSingle.mockResolvedValue({ data: { medico_id: 'medico-1', empresa_id: null, cliente_contabilidade_id: null } });
  mockResolverPagadorDoResultado.mockResolvedValue(PAGADOR_FIXTURE);
  mockJaDisparado.mockResolvedValue(false);
  mockRegistrarDisparo.mockResolvedValue({});
});

describe('GET /api/cron/lembretes-vencimento', () => {
  it('sem Authorization → 401, não processa nada', async () => {
    const res = await req(undefined);
    expect(res.status).toBe(401);
    expect(mockListarBoletosVencendoEm).not.toHaveBeenCalled();
  });

  it('CRON_SECRET não configurado no ambiente → sempre 401, mesmo com bearer correto', async () => {
    mockEnv.CRON_SECRET = undefined;
    const res = await req('segredo-com-mais-de-16-chars');
    expect(res.status).toBe(401);
  });

  it('lembrete desabilitado na config → 200 no-op, não lista candidatos', async () => {
    mockLerConfigLembrete.mockResolvedValue({ habilitado: false });
    const res = await req('segredo-com-mais-de-16-chars');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ enviado: false });
    expect(mockListarBoletosVencendoEm).not.toHaveBeenCalled();
  });

  it('boleto elegível com WhatsApp e e-mail → dispara os dois canais e registra tipo lembrete_vencimento', async () => {
    mockListarBoletosVencendoEm.mockResolvedValue([BOLETO_FIXTURE]);

    const res = await req('segredo-com-mais-de-16-chars');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ enviado: true, candidatos: 1, enviados: 1, falhas: 0, pulados: 0 });
    expect(mockEnviarDocumentoPorUrl).toHaveBeenCalledTimes(1);
    expect(mockEnviarLembreteVencimento).toHaveBeenCalledTimes(1);
    expect(mockRegistrarDisparo).toHaveBeenCalledWith(
      expect.objectContaining({ boletoId: 'boleto-1', canal: 'whatsapp', status: 'sucesso', tipo: 'lembrete_vencimento' }),
    );
    expect(mockRegistrarDisparo).toHaveBeenCalledWith(
      expect.objectContaining({ boletoId: 'boleto-1', canal: 'email', status: 'sucesso', tipo: 'lembrete_vencimento' }),
    );
  });

  it('já disparado (idempotência) → pula sem tentar enviar de novo', async () => {
    mockListarBoletosVencendoEm.mockResolvedValue([BOLETO_FIXTURE]);
    mockJaDisparado.mockResolvedValue(true);

    const res = await req('segredo-com-mais-de-16-chars');
    const body = await res.json();

    expect(body).toMatchObject({ pulados: 1, enviados: 0 });
    expect(mockEnviarDocumentoPorUrl).not.toHaveBeenCalled();
    expect(mockEnviarLembreteVencimento).not.toHaveBeenCalled();
    expect(mockRegistrarDisparo).not.toHaveBeenCalled();
  });

  it('pagador sem WhatsApp nem e-mail → pula silenciosamente, não registra falha', async () => {
    mockListarBoletosVencendoEm.mockResolvedValue([BOLETO_FIXTURE]);
    mockResolverPagadorDoResultado.mockResolvedValue({
      ...PAGADOR_FIXTURE,
      cobranca: { pagadorTipo: 'PF', pagadorNome: 'Dr. Teste', whatsapp: null, email: '' },
    });

    const res = await req('segredo-com-mais-de-16-chars');
    const body = await res.json();

    expect(body).toMatchObject({ pulados: 1, enviados: 0, falhas: 0 });
    expect(mockRegistrarDisparo).not.toHaveBeenCalled();
  });

  it('boleto sem PDF no payload → pula sem lançar', async () => {
    mockListarBoletosVencendoEm.mockResolvedValue([{ ...BOLETO_FIXTURE, payloadResposta: {} }]);

    const res = await req('segredo-com-mais-de-16-chars');
    const body = await res.json();

    expect(body).toMatchObject({ pulados: 1, enviados: 0 });
    expect(mockResolverPagadorDoResultado).not.toHaveBeenCalled();
  });
});
