// Testes da rota GET /api/relatorios/publico/[token] (BI público, Módulo de Relatórios).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBuscarLinkValidoPorToken = vi.fn();
const mockRegistrarAcesso = vi.fn();
vi.mock('@/server/repositories/relatorio-links-repository', () => ({
  buscarLinkValidoPorToken: (...a: unknown[]) => mockBuscarLinkValidoPorToken(...a),
  registrarAcesso: (...a: unknown[]) => mockRegistrarAcesso(...a),
}));

const mockResumoPorCompetencia = vi.fn();
const mockResumoPorEmpresa = vi.fn();
const mockAging = vi.fn();
vi.mock('@/server/repositories/dashboard-repository', () => ({
  resumoPorCompetencia: (...a: unknown[]) => mockResumoPorCompetencia(...a),
  resumoPorEmpresa: (...a: unknown[]) => mockResumoPorEmpresa(...a),
  aging: (...a: unknown[]) => mockAging(...a),
}));

import { GET } from '@/app/api/relatorios/publico/[token]/route';

function reqGet(token: string, qs = '') {
  return GET(new Request(`http://test/api/relatorios/publico/${token}${qs}`), { params: { token } });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/relatorios/publico/[token]', () => {
  it('token inválido/revogado/expirado → 404 uniforme, sem consultar dashboard', async () => {
    mockBuscarLinkValidoPorToken.mockResolvedValue(null);
    const res = await reqGet('tok-invalido');
    expect(res.status).toBe(404);
    expect(mockResumoPorCompetencia).not.toHaveBeenCalled();
    expect(mockRegistrarAcesso).not.toHaveBeenCalled();
  });

  it('token válido → 200 com o payload agregado', async () => {
    mockBuscarLinkValidoPorToken.mockResolvedValue({
      id: 'link-1',
      token: 'tok-ok',
      nome: 'BI da CEO',
      escopoContaEmissora: null,
      criadoPor: 'u1',
      criadoEm: '2026-06-01T00:00:00Z',
      expiraEm: null,
      revogadoEm: null,
      ultimoAcessoEm: null,
    });
    mockResumoPorCompetencia.mockResolvedValue([
      { competencia: null, qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
      { competencia: '2026-06', qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
    ]);
    mockResumoPorEmpresa.mockResolvedValue([
      { contaEmissora: 'mc', competencia: null, qtdBoletos: 10, totalEmitido: 5000, totalRecebido: 3000, totalEmAberto: 1000, totalVencido: 1000, taxaInadimplencia: 0.2 },
    ]);
    mockAging.mockResolvedValue([{ faixa: '0-30', qtd: 2, total: 900 }]);

    const res = await reqGet('tok-ok');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nomeLink).toBe('BI da CEO');
    expect(body.competenciasDisponiveis).toEqual(['2026-06']);
    expect(body.kpi.competencia).toBeNull(); // rollup por padrão (sem filtro de competência)
    expect(body.evolucaoMensal).toHaveLength(1);
    expect(body.porEmpresa[0]).toMatchObject({ contaEmissora: 'mc', contaEmissoraLabel: 'MC' });
    expect(body.aging).toHaveLength(1);
  });

  it('nunca expõe nome de médico, boletoId ou idExterno no payload', async () => {
    mockBuscarLinkValidoPorToken.mockResolvedValue({
      id: 'link-1', token: 'tok-ok', nome: 'BI', escopoContaEmissora: null, criadoPor: 'u1',
      criadoEm: '2026-06-01T00:00:00Z', expiraEm: null, revogadoEm: null, ultimoAcessoEm: null,
    });
    mockResumoPorCompetencia.mockResolvedValue([]);
    mockResumoPorEmpresa.mockResolvedValue([]);
    mockAging.mockResolvedValue([]);

    const res = await reqGet('tok-ok');
    const body = await res.json();
    // "nomeLink" é o nome do LINK (escolhido pelo admin), legítimo de aparecer — a checagem é
    // por chaves de dado sensível linha-a-linha, não por substring (que pegaria "nomeLink").
    const chavesProibidas = ['nome', 'boletoId', 'idExterno', 'medicoId'];
    function coletarChaves(v: unknown, acc: Set<string>): void {
      if (Array.isArray(v)) {
        v.forEach((i) => coletarChaves(i, acc));
      } else if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) {
          acc.add(k);
          coletarChaves(val, acc);
        }
      }
    }
    const chaves = new Set<string>();
    coletarChaves(body, chaves);
    for (const proibida of chavesProibidas) {
      expect(chaves.has(proibida)).toBe(false);
    }
  });

  it('respeita o escopo de conta emissora do link', async () => {
    mockBuscarLinkValidoPorToken.mockResolvedValue({
      id: 'link-1', token: 'tok-ok', nome: 'BI', escopoContaEmissora: 'cc_solucoes', criadoPor: 'u1',
      criadoEm: '2026-06-01T00:00:00Z', expiraEm: null, revogadoEm: null, ultimoAcessoEm: null,
    });
    mockResumoPorCompetencia.mockResolvedValue([]);
    mockResumoPorEmpresa.mockResolvedValue([]);
    mockAging.mockResolvedValue([]);

    await reqGet('tok-ok');
    expect(mockResumoPorCompetencia).toHaveBeenCalledWith(undefined, 'cc_solucoes');
    expect(mockResumoPorEmpresa).toHaveBeenCalledWith(undefined, 'cc_solucoes');
    expect(mockAging).toHaveBeenCalledWith(undefined, 'cc_solucoes');
  });

  it('filtro de competência via querystring propaga pras 3 buscas', async () => {
    mockBuscarLinkValidoPorToken.mockResolvedValue({
      id: 'link-1', token: 'tok-ok', nome: 'BI', escopoContaEmissora: null, criadoPor: 'u1',
      criadoEm: '2026-06-01T00:00:00Z', expiraEm: null, revogadoEm: null, ultimoAcessoEm: null,
    });
    mockResumoPorCompetencia.mockResolvedValue([]);
    mockResumoPorEmpresa.mockResolvedValue([]);
    mockAging.mockResolvedValue([]);

    await reqGet('tok-ok', '?competencia=2026-05');
    expect(mockResumoPorEmpresa).toHaveBeenCalledWith('2026-05', undefined);
    expect(mockAging).toHaveBeenCalledWith('2026-05', undefined);
  });

  it('registra o acesso (fire-and-forget) quando o token é válido', async () => {
    mockBuscarLinkValidoPorToken.mockResolvedValue({
      id: 'link-1', token: 'tok-ok', nome: 'BI', escopoContaEmissora: null, criadoPor: 'u1',
      criadoEm: '2026-06-01T00:00:00Z', expiraEm: null, revogadoEm: null, ultimoAcessoEm: null,
    });
    mockResumoPorCompetencia.mockResolvedValue([]);
    mockResumoPorEmpresa.mockResolvedValue([]);
    mockAging.mockResolvedValue([]);

    await reqGet('tok-ok');
    expect(mockRegistrarAcesso).toHaveBeenCalledWith('link-1', null);
  });
});
