import ExcelJS from 'exceljs';
import * as path from 'path';

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Médicos');

  // Columns definition
  sheet.columns = [
    { header: 'cpf', key: 'cpf', width: 15 },
    { header: 'nome', key: 'nome', width: 30 },
    { header: 'especialidade', key: 'especialidade', width: 20 },
    { header: 'status_hapvida', key: 'status_hapvida', width: 20 },
    { header: 'faz_outros_hospitais', key: 'faz_outros_hospitais', width: 20 },
    { header: 'faz_imobilizacoes', key: 'faz_imobilizacoes', width: 20 },
    { header: 'modo_mudanca_data', key: 'modo_mudanca_data', width: 20 },
    { header: 'colaborador_responsavel', key: 'colaborador_responsavel', width: 25 },
    { header: 'pagador_tipo', key: 'pagador_tipo', width: 15 },
    { header: 'pagador_documento', key: 'pagador_documento', width: 20 },
    { header: 'pagador_nome', key: 'pagador_nome', width: 30 },
    { header: 'whatsapp', key: 'whatsapp', width: 20 },
    { header: 'email', key: 'email', width: 30 },
    { header: 'cep', key: 'cep', width: 15 },
    { header: 'logradouro', key: 'logradouro', width: 30 },
    { header: 'numero', key: 'numero', width: 10 },
    { header: 'complemento', key: 'complemento', width: 20 },
    { header: 'bairro', key: 'bairro', width: 20 },
    { header: 'cidade', key: 'cidade', width: 20 },
    { header: 'uf', key: 'uf', width: 10 }
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' } // Dark gray/blackish for premium look
    };
    cell.font = {
      color: { argb: 'FFFFFFFF' },
      bold: true
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 25;

  // Example data
  sheet.addRow({
    cpf: '12345678900',
    nome: 'Dr. Fulano de Tal',
    especialidade: 'Cardiologia',
    status_hapvida: 'credenciado',
    faz_outros_hospitais: 'nao',
    faz_imobilizacoes: 'nao',
    modo_mudanca_data: 'nao',
    colaborador_responsavel: 'Maria',
    pagador_tipo: 'PF',
    pagador_documento: '12345678900',
    pagador_nome: 'Dr. Fulano de Tal',
    whatsapp: '5511999999999',
    email: 'fulano@exemplo.com',
    cep: '60000000',
    logradouro: 'Rua das Flores',
    numero: '100',
    complemento: 'Sala 2',
    bairro: 'Centro',
    cidade: 'Fortaleza',
    uf: 'CE'
  });

  sheet.addRow({
    cpf: '98765432100',
    nome: 'Dra. Ciclana',
    especialidade: 'Pediatria',
    status_hapvida: 'nao_credenciado',
    faz_outros_hospitais: 'nao',
    faz_imobilizacoes: 'nao',
    modo_mudanca_data: 'nao',
    colaborador_responsavel: 'Joao',
    pagador_tipo: 'PJ',
    pagador_documento: '12345678000199',
    pagador_nome: 'Clinica Ciclana LTDA',
    whatsapp: '5511888888888',
    email: 'contato@ciclana.com',
    cep: '60110000',
    logradouro: 'Avenida Beira Mar',
    numero: '2000',
    complemento: '',
    bairro: 'Meireles',
    cidade: 'Fortaleza',
    uf: 'CE'
  });

  const outPath = path.join(process.cwd(), 'public/templates/medicos-modelo.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Template XLSX gerado em', outPath);
}

main().catch(console.error);
