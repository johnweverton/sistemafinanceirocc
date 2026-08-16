// Exportação em PDF do relatório de recebíveis agrupado por empresa — Módulo de Relatórios.
// pdfkit (não Puppeteer/@react-pdf/renderer): sem Chromium, cold start ok em serverless, API
// imperativa/streaming no mesmo espírito de ofx.ts. Fonte padrão Helvetica cobre acentuação
// pt-BR (WinAnsi/Latin-1) sem precisar embutir TTF. Função "pura" no sentido de I/O: recebe o
// relatório já agrupado e devolve um Buffer, sem tocar disco/rede.
import PDFDocument from 'pdfkit';
import type { RelatorioRecebiveis, StatusRecebivel } from '@cobranca/shared';

const STATUS_LABEL: Record<StatusRecebivel, string> = {
  pago: 'Pago',
  cancelado: 'Cancelado',
  vencido: 'Vencido',
  em_aberto: 'Em aberto',
};

const MARGEM = 40;
const COLUNAS = [
  { titulo: 'Médico/Cliente', largura: 170 },
  { titulo: 'Competência', largura: 80 },
  { titulo: 'Vencimento', largura: 80 },
  { titulo: 'Valor', largura: 80 },
  { titulo: 'Status', largura: 70 },
  { titulo: 'Pago em', largura: 80 },
  { titulo: 'Valor pago', largura: 80 },
] as const;

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** AAAA-MM-DD (ou timestamp ISO) → DD/MM/AAAA. String pura (sem passar por Date) para não
 *  sofrer deslocamento de fuso horário — mesmo padrão de formatarDataBR em gateway/mensagem-boleto.ts. */
function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function descreverFiltro(filtro: RelatorioRecebiveis['filtro'], labelEmpresa: string | null): string {
  const partes: string[] = [];
  partes.push(filtro.competencia ? `Competência: ${filtro.competencia}` : 'Todas as competências');
  partes.push(labelEmpresa ? `Empresa: ${labelEmpresa}` : 'Todas as empresas');
  return partes.join(' · ');
}

export async function gerarRelatorioRecebiveisPdf(
  relatorio: RelatorioRecebiveis,
  labelEmpresaFiltro: string | null = null,
): Promise<Buffer> {
  const doc = new PDFDocument({ margin: MARGEM, size: 'A4', layout: 'landscape' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const fim = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const larguraPagina = doc.page.width - MARGEM * 2;

  doc.fontSize(16).font('Helvetica-Bold').text('Relatório de Recebíveis', { align: 'left' });
  doc.fontSize(10).font('Helvetica').text(descreverFiltro(relatorio.filtro, labelEmpresaFiltro));
  doc.text(`Gerado em ${new Date(relatorio.geradoEm).toLocaleString('pt-BR')}`);
  doc.moveDown(1);

  function garantirEspaco(alturaNecessaria: number): void {
    if (doc.y + alturaNecessaria > doc.page.height - MARGEM) {
      doc.addPage();
    }
  }

  function desenharCabecalhoTabela(): void {
    garantirEspaco(20);
    let x = MARGEM;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    for (const col of COLUNAS) {
      doc.text(col.titulo, x, y, { width: col.largura });
      x += col.largura;
    }
    doc.moveDown(0.5);
    doc.moveTo(MARGEM, doc.y).lineTo(MARGEM + larguraPagina, doc.y).strokeColor('#999').stroke();
    doc.moveDown(0.3);
  }

  function desenharLinha(valores: string[], negrito = false): void {
    garantirEspaco(16);
    let x = MARGEM;
    const y = doc.y;
    doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    valores.forEach((valor, i) => {
      const col = COLUNAS[i]!;
      doc.text(valor, x, y, { width: col.largura });
      x += col.largura;
    });
    doc.moveDown(0.6);
  }

  for (const grupo of relatorio.grupos) {
    garantirEspaco(40);
    doc.font('Helvetica-Bold').fontSize(12).text(grupo.contaEmissoraLabel);
    doc.moveDown(0.3);
    desenharCabecalhoTabela();

    for (const r of grupo.linhas) {
      desenharLinha([
        r.nome,
        r.competencia,
        r.vencimento ? formatarDataBr(r.vencimento) : '—',
        formatarMoeda(r.valor ?? 0),
        STATUS_LABEL[r.statusDerivado],
        r.pagoEm ? formatarDataBr(r.pagoEm) : '—',
        r.valorPago != null ? formatarMoeda(r.valorPago) : '—',
      ]);
    }

    desenharLinha(
      [
        `Subtotal ${grupo.contaEmissoraLabel}`,
        '',
        '',
        formatarMoeda(grupo.subtotal.totalEmitido),
        `Pago ${formatarMoeda(grupo.subtotal.totalPago)}`,
        '',
        '',
      ],
      true,
    );
    doc.moveDown(0.8);
  }

  garantirEspaco(20);
  doc.moveDown(0.3);
  desenharLinha(
    [
      'TOTAL GERAL',
      '',
      '',
      formatarMoeda(relatorio.totalGeral.totalEmitido),
      `Pago ${formatarMoeda(relatorio.totalGeral.totalPago)}`,
      '',
      '',
    ],
    true,
  );

  doc.end();
  return fim;
}
