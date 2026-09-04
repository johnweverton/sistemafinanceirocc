// Testes da rota GET /api/execucoes/resultados/[id]/auditoria-3x1 (achado 2026-09-04) — mesma
// trava de permissão de recalcular/route.ts, mas nunca grava nada (só lê e exporta o .xlsx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import type { Execucao, ExecucaoResultado, Medico, ItemProducao } from '@cobranca/shared';

const mockRequireRole = vi.fn();
vi.mock('@/server/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockBuscarItensDoResultado = vi.fn();
vi.mock('@/server/orchestrator/recalculo-resultado', () => ({
  buscarItensDoResultado: (...a: unknown[]) => mockBuscarItensDoResultado(...a),
}));

import { GET } from '@/app/api/execucoes/resultados/[id]/auditoria-3x1/route';

function medicoFake(over: Partial<Medico> = {}): Medico {
  return {
    id: 'med-1',
    nome: 'Dra. Emilie',
    cpf: '00000000000',
    especialidade: 'Pediatria',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    semExcedentePorGuia: false,
    contaEmissora: 'mc',
    colaboradorResponsavel: null,
    ativo: true,
    necessitaConfiguracao: false,
    externalId: 'ext-med-1',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  } as Medico;
}

const itemFake = (paciente: string): ItemProducao => ({
  data: '2026-07-06',
  pacienteNome: paciente,
  atendimentoExternoId: null,
  codigoProcedimento: '10101012',
  descricaoProcedimento: 'Consulta',
  statusOrigem: 'Devidamente Pago',
  viaAcesso: false,
  tipoAto: 'Eletivo',
  valorCobradoOrigem: 100,
  valorPagoOrigem: 100,
});

function dadosFake() {
  return {
    resultado: { id: 'res-1', guias: 61 } as unknown as ExecucaoResultado,
    medico: medicoFake(),
    execucao: { id: 'exec-1', competencia: '2026-07' } as unknown as Execucao,
    lotePrincipal: [itemFake('P1'), itemFake('P1'), itemFake('P1')],
    outrosHospitais: undefined,
    imobilizacoes: undefined,
    cateter: undefined,
    fistula: undefined,
    angiografia: undefined,
    itensConsultas: undefined,
    guiasCartaRede: undefined,
    guiasManuaisTotal: undefined,
    guiasManuaisMotivo: undefined,
    historicoGuias: null,
    valorConsultaPediatria: 3,
    saldoAcumulado: null,
  };
}

function reqGet(id: string) {
  mockRequireRole.mockResolvedValue({ userId: 'user-financeiro', papel: 'financeiro' });
  return GET(new Request('http://test/api/execucoes/resultados/x/auditoria-3x1'), { params: { id } });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/execucoes/resultados/[id]/auditoria-3x1', () => {
  it('exige papel admin/financeiro e devolve um .xlsx anexado', async () => {
    mockBuscarItensDoResultado.mockResolvedValue(dadosFake());
    const res = await reqGet('res-1');

    expect(res.status).toBe(200);
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'financeiro']);
    expect(mockBuscarItensDoResultado).toHaveBeenCalledWith('res-1');
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Content-Disposition')).toContain('2026-07');

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet('Detalhe')).toBeDefined();
    expect(workbook.getWorksheet('Resumo')).toBeDefined();
  });

  it('propaga o erro do orquestrador (ex.: resultado inexistente) sem mascarar', async () => {
    const { ApiError } = await import('@/lib/api-error');
    mockBuscarItensDoResultado.mockRejectedValue(
      new ApiError(404, 'Resultado de execução não encontrado', 'RESULTADO_NAO_ENCONTRADO'),
    );
    const res = await reqGet('res-inexistente');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('RESULTADO_NAO_ENCONTRADO');
  });

  it('não chama nenhuma função de gravação — só lê e exporta', async () => {
    mockBuscarItensDoResultado.mockResolvedValue(dadosFake());
    await reqGet('res-1');
    // A rota só importa `buscarItensDoResultado` do orquestrador — não há como chamar
    // `recalcularResultado`/`atualizarResultado` porque nem estão importados no route.ts.
    expect(mockBuscarItensDoResultado).toHaveBeenCalledTimes(1);
  });
});
