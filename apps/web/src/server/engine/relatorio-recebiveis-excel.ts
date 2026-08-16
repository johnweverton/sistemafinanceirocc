// Exportação em Excel do relatório de recebíveis agrupado por empresa — Módulo de Relatórios.
// Primeiro uso de ESCRITA de exceljs no projeto (a dependência já é usada só para leitura em
// server/csv/planilha-import.ts). Função pura: recebe o relatório já agrupado (engine
// relatorio-recebiveis.ts) e devolve o buffer do arquivo, sem I/O de rede/disco.
import ExcelJS from 'exceljs';
import type { RelatorioRecebiveis, StatusRecebivel } from '@cobranca/shared';

const STATUS_LABEL: Record<StatusRecebivel, string> = {
  pago: 'Pago',
  cancelado: 'Cancelado',
  vencido: 'Vencido',
  em_aberto: 'Em aberto',
};

/**
 * AAAA-MM-DD (ou timestamp ISO) → Date local à meia-noite, construída a partir das partes da
 * string (nunca via `new Date(iso)` direto) — evita o deslocamento de um dia que o parser ISO
 * do JS introduz em fusos negativos (Brasil, UTC-3) para datas sem hora. A célula recebe um
 * Date real (não texto) com numFmt 'dd/mm/yyyy', pra ficar ordenável/filtrável no Excel.
 */
function paraDataExcel(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(ano!, mes! - 1, dia!);
}

const COLUNAS = [
  { header: 'Empresa', key: 'empresa', width: 22 },
  { header: 'Médico/Cliente', key: 'nome', width: 28 },
  { header: 'Competência', key: 'competencia', width: 14 },
  { header: 'Vencimento', key: 'vencimento', width: 14 },
  { header: 'Valor', key: 'valor', width: 14 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Pago em', key: 'pagoEm', width: 14 },
  { header: 'Valor pago', key: 'valorPago', width: 14 },
] as const;

export async function gerarRelatorioRecebiveisExcel(relatorio: RelatorioRecebiveis): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(relatorio.geradoEm);
  const sheet = workbook.addWorksheet('Recebíveis');
  sheet.columns = COLUNAS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };

  for (const grupo of relatorio.grupos) {
    for (const r of grupo.linhas) {
      sheet.addRow({
        empresa: grupo.contaEmissoraLabel,
        nome: r.nome,
        competencia: r.competencia,
        vencimento: r.vencimento ? paraDataExcel(r.vencimento) : '',
        valor: r.valor ?? 0,
        status: STATUS_LABEL[r.statusDerivado],
        pagoEm: r.pagoEm ? paraDataExcel(r.pagoEm) : '',
        valorPago: r.valorPago ?? '',
      });
    }
    const linhaSubtotal = sheet.addRow({
      empresa: `Subtotal ${grupo.contaEmissoraLabel}`,
      valor: grupo.subtotal.totalEmitido,
      status: `Pago: ${grupo.subtotal.totalPago.toFixed(2)} · Em aberto: ${grupo.subtotal.totalEmAberto.toFixed(2)} · Vencido: ${grupo.subtotal.totalVencido.toFixed(2)}`,
    });
    linhaSubtotal.font = { bold: true };
  }

  const linhaTotal = sheet.addRow({
    empresa: 'TOTAL GERAL',
    valor: relatorio.totalGeral.totalEmitido,
    status: `Pago: ${relatorio.totalGeral.totalPago.toFixed(2)} · Em aberto: ${relatorio.totalGeral.totalEmAberto.toFixed(2)} · Vencido: ${relatorio.totalGeral.totalVencido.toFixed(2)}`,
  });
  linhaTotal.font = { bold: true };

  sheet.getColumn('valor').numFmt = '#,##0.00';
  sheet.getColumn('valorPago').numFmt = '#,##0.00';
  sheet.getColumn('vencimento').numFmt = 'dd/mm/yyyy';
  sheet.getColumn('pagoEm').numFmt = 'dd/mm/yyyy';

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
