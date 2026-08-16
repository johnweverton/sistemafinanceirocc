// Testes da geração de PDF do relatório de recebíveis (Módulo de Relatórios). pdfkit não expõe
// um parser reverso simples de texto — os testes validam buffer não vazio e magic bytes
// (%PDF-), e que a função não lança para relatórios vazios/multi-grupo/multi-página.
import { describe, it, expect } from 'vitest';
import { gerarRelatorioRecebiveisPdf } from '@/server/engine/relatorio-recebiveis-pdf';
import { agruparRecebiveisPorEmpresa } from '@/server/engine/relatorio-recebiveis';
import type { Recebivel } from '@cobranca/shared';

function recebivel(overrides: Partial<Recebivel> = {}): Recebivel {
  return {
    boletoId: 'b1',
    execucaoResultadoId: 'er1',
    idExterno: 'ext1',
    competencia: '2026-06',
    medicoId: 'm1',
    nome: 'Dr. A',
    valor: 1000,
    vencimento: '2026-06-10',
    pagoEm: null,
    valorPago: null,
    emitidoEm: '2026-06-01T00:00:00Z',
    contaEmissora: 'mc',
    statusDerivado: 'em_aberto',
    ...overrides,
  };
}

describe('gerarRelatorioRecebiveisPdf', () => {
  it('gera um buffer PDF válido (magic bytes %PDF-) para relatório vazio', async () => {
    const relatorio = agruparRecebiveisPorEmpresa([], {});
    const buffer = await gerarRelatorioRecebiveisPdf(relatorio);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('gera PDF para relatório com múltiplos grupos e muitas linhas (paginação)', async () => {
    const recebiveis: Recebivel[] = [];
    for (let i = 0; i < 60; i++) {
      recebiveis.push(recebivel({ boletoId: `b${i}`, nome: `Dr. ${i}`, contaEmissora: i % 2 === 0 ? 'mc' : 'cc_solucoes' }));
    }
    const relatorio = agruparRecebiveisPorEmpresa(recebiveis, { competencia: '2026-06' });
    const buffer = await gerarRelatorioRecebiveisPdf(relatorio, 'Todas');
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
