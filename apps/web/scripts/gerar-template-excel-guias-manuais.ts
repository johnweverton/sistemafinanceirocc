import ExcelJS from 'exceljs';
import * as path from 'path';

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Guias manuais');

  // Mesmas colunas, na mesma ordem, do template CSV (public/templates/guias-manuais-modelo.csv) —
  // os dois precisam ficar sincronizados com o parser (server/csv/guias-manuais-import.ts).
  // `nome` é só conferência visual: o cruzamento com o cadastro é SEMPRE por CPF. As 4 colunas de
  // total (achado 2026-09-04) são cada uma OPCIONAL por linha — preenche só a(s) classe(s) que
  // conferiu à mão pra aquele médico; guias normais, consultas, imobilizações e outros hospitais
  // têm tabelas de preço diferentes, por isso não dá pra somar tudo numa coluna só.
  sheet.columns = [
    { header: 'cpf', key: 'cpf', width: 18 },
    { header: 'nome', key: 'nome', width: 30 },
    { header: 'competencia', key: 'competencia', width: 14 },
    { header: 'total_guias', key: 'total_guias', width: 14 },
    { header: 'total_consultas', key: 'total_consultas', width: 16 },
    { header: 'total_imobilizacoes', key: 'total_imobilizacoes', width: 18 },
    { header: 'total_outros_hospitais', key: 'total_outros_hospitais', width: 20 },
    { header: 'motivo', key: 'motivo', width: 60 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 25;

  // CPF e competência como TEXTO: sem isso o Excel come o zero à esquerda do CPF e converte
  // "2026-06" em data — os dois quebrariam o cruzamento/validação na importação.
  sheet.getColumn('cpf').numFmt = '@';
  sheet.getColumn('competencia').numFmt = '@';

  sheet.addRow({
    cpf: '11144477735',
    nome: 'Dr. Fulano de Tal',
    competencia: '2026-06',
    total_guias: 42,
    motivo: 'Conferencia manual do dono - contagem automatica divergiu em 3 guias',
  });

  sheet.addRow({
    cpf: '98765432100',
    nome: 'Dra. Ciclana',
    competencia: '2026-06',
    total_guias: 7,
    motivo: 'Exceções de procedimento nao cobertas pela regra automatica',
  });

  sheet.addRow({
    cpf: '52998224725',
    nome: 'Dr. Pedro Infante',
    competencia: '2026-06',
    total_guias: 15,
    total_consultas: 40,
    motivo: 'Guias normais e consultas do mes conferidas a mao - contagem automatica das consultas divergiu',
  });

  sheet.addRow({
    cpf: '15350946056',
    nome: 'Dr. Vitor Imob',
    competencia: '2026-06',
    total_imobilizacoes: 12,
    motivo: 'Lote de Imobilizacoes conferido a mao - sub-lote nao reconhecido pelo nome',
  });

  sheet.addRow({
    cpf: '12345678909',
    nome: 'Dra. Marta Hospitais',
    competencia: '2026-06',
    total_outros_hospitais: 9,
    motivo: 'Lote de Outros Hospitais conferido a mao',
  });

  const outPath = path.join(process.cwd(), 'public/templates/guias-manuais-modelo.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Template XLSX gerado em', outPath);
}

main().catch(console.error);
