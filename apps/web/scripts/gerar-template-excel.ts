import ExcelJS from 'exceljs';
import * as path from 'path';

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Médicos');

  // Mesmas colunas, na mesma ordem, do template CSV (public/templates/medicos-modelo.csv) — os
  // dois precisam ficar sincronizados com o parser (server/csv/medicos-import.ts).
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
    { header: 'email', key: 'email', width: 30 },
    { header: 'whatsapp', key: 'whatsapp', width: 20 },
    { header: 'cep', key: 'cep', width: 15 },
    { header: 'logradouro', key: 'logradouro', width: 30 },
    { header: 'numero', key: 'numero', width: 10 },
    { header: 'complemento', key: 'complemento', width: 20 },
    { header: 'bairro', key: 'bairro', width: 20 },
    { header: 'cidade', key: 'cidade', width: 20 },
    { header: 'uf', key: 'uf', width: 10 },
    { header: 'conta_emissora', key: 'conta_emissora', width: 18 },
    { header: 'modo_cobranca', key: 'modo_cobranca', width: 20 },
    { header: 'percentual_producao', key: 'percentual_producao', width: 18 },
    { header: 'dias_vencimento', key: 'dias_vencimento', width: 16 },
    { header: 'multa_percent', key: 'multa_percent', width: 15 },
    { header: 'juros_mes_percent', key: 'juros_mes_percent', width: 16 },
    { header: 'desconto_percent', key: 'desconto_percent', width: 16 },
    { header: 'desconto_dias', key: 'desconto_dias', width: 14 },
    { header: 'regra_preco_forma', key: 'regra_preco_forma', width: 18 },
    { header: 'regra_preco_base', key: 'regra_preco_base', width: 16 },
    { header: 'regra_preco_limiar', key: 'regra_preco_limiar', width: 16 },
    { header: 'regra_preco_taxa', key: 'regra_preco_taxa', width: 16 },
    { header: 'regra_preco_valor_fixo', key: 'regra_preco_valor_fixo', width: 18 },
    { header: 'empresa_grupo', key: 'empresa_grupo', width: 25 },
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
    email: 'fulano@exemplo.com',
    whatsapp: '85999998888',
    cep: '60000000',
    logradouro: 'Rua das Flores',
    numero: '100',
    complemento: 'Sala 2',
    bairro: 'Centro',
    cidade: 'Fortaleza',
    uf: 'CE',
    conta_emissora: 'mc',
    modo_cobranca: 'faixa_guias',
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
    email: 'contato@ciclana.com',
    whatsapp: '',
    cep: '60110000',
    logradouro: 'Avenida Beira Mar',
    numero: '2000',
    complemento: '',
    bairro: 'Meireles',
    cidade: 'Fortaleza',
    uf: 'CE',
    conta_emissora: 'cavalcante_viana',
    modo_cobranca: 'faixa_guias',
  });

  sheet.addRow({
    cpf: '11122233344',
    nome: 'Dr. Beltrano',
    especialidade: 'Ortopedia',
    status_hapvida: 'nenhum',
    faz_outros_hospitais: 'sim',
    faz_imobilizacoes: 'sim',
    modo_mudanca_data: 'nao',
    colaborador_responsavel: 'Maria',
    modo_cobranca: 'percentual_producao',
    percentual_producao: 35,
  });

  sheet.addRow({
    cpf: '55566677788',
    nome: 'Dr. Preco Proprio',
    especialidade: 'Neurologia',
    status_hapvida: 'credenciado',
    faz_outros_hospitais: 'nao',
    faz_imobilizacoes: 'nao',
    modo_mudanca_data: 'nao',
    colaborador_responsavel: 'Maria',
    modo_cobranca: 'preco_proprio',
    regra_preco_forma: 'por_guia',
    regra_preco_taxa: 4.0,
  });

  const outPath = path.join(process.cwd(), 'public/templates/medicos-modelo.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Template XLSX gerado em', outPath);
}

main().catch(console.error);
