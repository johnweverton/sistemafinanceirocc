// Testes do ZappyGateway — foco na normalização de número (achado 2026-09-02): um telefone PF
// cadastrado com máscara humana ("(85) 98721-6266") tem hífen no meio, igual um ID de grupo do
// Whaticket ("558597180005-1552156770") — a normalização precisa distinguir os dois casos, senão
// o número formatado vai pro Zappy sem normalizar e o envio falha.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = {
  ZAPPY_API_URL: 'https://api-empresa.zapcontabil.chat',
  ZAPPY_API_TOKEN: 'token-teste',
  ZAPPY_CONNECTION_ID: 6,
};
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({ ...mockEnv })),
}));

import { ZappyGateway } from '@/server/gateway/zappy-gateway';

function mockFetchOk(body: unknown = { status: true }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ZappyGateway — normalização de número', () => {
  it('telefone PF com máscara humana "(85) 98721-6266" → normaliza para 5585987216266', async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal('fetch', fetchMock);

    await new ZappyGateway().enviarTexto('(85) 98721-6266', 'Olá');

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/send/5585987216266');
  });

  it('telefone já normalizado (só dígitos, com DDI) passa igual', async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal('fetch', fetchMock);

    await new ZappyGateway().enviarTexto('5585987216266', 'Olá');

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/send/5585987216266');
  });

  it('telefone sem DDI (10 ou 11 dígitos) ganha o prefixo 55', async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal('fetch', fetchMock);

    await new ZappyGateway().enviarTexto('85987216266'.slice(0, 11), 'Olá');

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/send/5585987216266');
  });

  it('ID de grupo do Whaticket (só dígitos-hífen-dígitos) passa direto, sem normalizar', async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal('fetch', fetchMock);

    await new ZappyGateway().enviarTexto('558597180005-1552156770', 'Olá');

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/send/558597180005-1552156770');
  });
});
