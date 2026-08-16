// Testes da geração de Excel do relatório de recebíveis (Módulo de Relatórios). Reabre o
// buffer com ExcelJS para validar conteúdo real, não só que o buffer não está vazio.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { gerarRelatorioRecebiveisExcel } from '@/server/engine/relatorio-recebiveis-excel';
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

describe('gerarRelatorioRecebiveisExcel', () => {
  it('gera um buffer não vazio', async () => {
    const relatorio = agruparRecebiveisPorEmpresa([recebivel()], {});
    const buffer = await gerarRelatorioRecebiveisExcel(relatorio);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('reabre o arquivo e valida cabeçalho, linhas e valores', async () => {
    const recebiveis = [
      recebivel({ boletoId: 'b1', nome: 'Dr. A', contaEmissora: 'mc', valor: 1000, statusDerivado: 'em_aberto' }),
      recebivel({ boletoId: 'b2', nome: 'Dr. B', contaEmissora: 'mc', valor: 500, statusDerivado: 'pago', valorPago: 500, pagoEm: '2026-06-15' }),
    ];
    const relatorio = agruparRecebiveisPorEmpresa(recebiveis, { competencia: '2026-06' });
    const buffer = await gerarRelatorioRecebiveisExcel(relatorio);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    // Colunas na ordem definida em COLUNAS: 1=empresa, 2=nome, 3=competencia, 4=vencimento,
    // 5=valor, 6=status, 7=pagoEm, 8=valorPago. Após serializar/reabrir o .xlsx, a
    // key→coluna do modelo em memória não é preservada (não é parte do formato) — só a
    // posição, por isso os testes usam índice numérico em vez de getCell('key').
    const headerRow = sheet.getRow(1).values as unknown[];
    expect(headerRow).toContain('Empresa');
    expect(headerRow).toContain('Valor');
    expect(headerRow).toContain('Status');

    // linha 2 = Dr. A, linha 3 = Dr. B, linha 4 = subtotal MC, linha 5 = total geral
    expect(sheet.getRow(2).getCell(2).value).toBe('Dr. A');
    expect(sheet.getRow(2).getCell(5).value).toBe(1000);
    expect(sheet.getRow(2).getCell(6).value).toBe('Em aberto');

    expect(sheet.getRow(3).getCell(2).value).toBe('Dr. B');
    expect(sheet.getRow(3).getCell(6).value).toBe('Pago');

    expect(sheet.getRow(4).getCell(1).value).toBe('Subtotal MC');
    expect(sheet.getRow(4).getCell(5).value).toBe(1500);

    expect(sheet.getRow(5).getCell(1).value).toBe('TOTAL GERAL');
    expect(sheet.getRow(5).getCell(5).value).toBe(1500);
  });

  it('lista vazia gera arquivo só com cabeçalho e total geral zerado', async () => {
    const relatorio = agruparRecebiveisPorEmpresa([], {});
    const buffer = await gerarRelatorioRecebiveisExcel(relatorio);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(2).getCell(1).value).toBe('TOTAL GERAL');
    expect(sheet.getRow(2).getCell(5).value).toBe(0);
  });
});
