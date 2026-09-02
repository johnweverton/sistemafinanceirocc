import ExcelJS from 'exceljs';
import * as path from 'path';

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Empresas');

  // Mesmas colunas, na mesma ordem, do template CSV (public/templates/empresas-modelo.csv) — os
  // dois precisam ficar sincronizados com o parser (server/csv/empresas-import.ts).
  sheet.columns = [
    { header: 'nome', key: 'nome', width: 30 },
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
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 25;

  sheet.addRow({
    nome: 'MEDISA Participacoes LTDA',
    pagador_tipo: 'PJ',
    pagador_documento: '11222333000181',
    pagador_nome: 'MEDISA Participacoes LTDA',
    email: 'contato@medisa.com.br',
    whatsapp: '85999998888',
    cep: '60110000',
    logradouro: 'Avenida Beira Mar',
    numero: '2000',
    complemento: 'Sala 10',
    bairro: 'Meireles',
    cidade: 'Fortaleza',
    uf: 'CE',
    conta_emissora: 'mc',
    regra_preco_forma: 'por_guia',
    regra_preco_taxa: 6.41,
  });

  sheet.addRow({
    nome: 'Clinica Exemplo LTDA',
    pagador_tipo: 'PJ',
    pagador_documento: '99888777000100',
    pagador_nome: 'Clinica Exemplo LTDA',
    cep: '60000000',
    logradouro: 'Rua das Flores',
    numero: '100',
    bairro: 'Centro',
    cidade: 'Fortaleza',
    uf: 'CE',
    conta_emissora: 'mc',
    dias_vencimento: 10,
    multa_percent: 2,
    juros_mes_percent: 1,
  });

  const outPath = path.join(process.cwd(), 'public/templates/empresas-modelo.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Template XLSX gerado em', outPath);
}

main().catch(console.error);
