import ExcelJS from 'exceljs';
import * as path from 'path';

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clientes Contabilidade');

  // Mesmas colunas, na mesma ordem, do template CSV
  // (public/templates/clientes-contabilidade-modelo.csv) — os dois precisam ficar sincronizados
  // com o parser (server/csv/clientes-contabilidade-import.ts).
  sheet.columns = [
    { header: 'nome', key: 'nome', width: 30 },
    { header: 'regime_tributario', key: 'regime_tributario', width: 20 },
    { header: 'modo_cobranca', key: 'modo_cobranca', width: 20 },
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
    { header: 'regra_preco_valor_abaixo_limiar', key: 'regra_preco_valor_abaixo_limiar', width: 28 },
    { header: 'regra_preco_valor_acima_limiar', key: 'regra_preco_valor_acima_limiar', width: 28 },
    { header: 'adicional_ativo', key: 'adicional_ativo', width: 16 },
    { header: 'adicional_valor', key: 'adicional_valor', width: 16 },
    { header: 'adicional_intervalo_meses', key: 'adicional_intervalo_meses', width: 22 },
    { header: 'adicional_competencia_base', key: 'adicional_competencia_base', width: 24 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 25;

  // Linha 1 — Simples Nacional + faixa_faturamento (cenário mais comum)
  sheet.addRow({
    nome: 'Padaria Bom Pao Ltda',
    regime_tributario: 'simples_nacional',
    modo_cobranca: 'faixa_faturamento',
    pagador_tipo: 'PJ',
    pagador_documento: '11222333000181',
    pagador_nome: 'Padaria Bom Pao Ltda',
    email: 'contato@bompao.com.br',
    whatsapp: '85988887777',
    cep: '60110000',
    logradouro: 'Rua do Trigo',
    numero: '50',
    bairro: 'Meireles',
    cidade: 'Fortaleza',
    uf: 'CE',
    conta_emissora: 'mc',
    regra_preco_forma: 'faixa_faturamento',
    regra_preco_limiar: 5000,
    regra_preco_valor_abaixo_limiar: 250,
    regra_preco_valor_acima_limiar: 480.56,
  });

  // Linha 2 — Lucro Presumido + fixo + overrides comerciais
  sheet.addRow({
    nome: 'Clinica Saude Total',
    regime_tributario: 'lucro_presumido',
    modo_cobranca: 'fixo',
    pagador_tipo: 'PJ',
    pagador_documento: '99888777000100',
    pagador_nome: 'Clinica Saude Total',
    email: 'contato@saudetotal.com.br',
    cep: '60000000',
    logradouro: 'Avenida Santos Dumont',
    numero: '1500',
    complemento: 'Sala 302',
    bairro: 'Aldeota',
    cidade: 'Fortaleza',
    uf: 'CE',
    conta_emissora: 'mc',
    dias_vencimento: 10,
    multa_percent: 2,
    juros_mes_percent: 1,
    regra_preco_forma: 'fixo',
    regra_preco_valor_fixo: 800,
  });

  // Linha 3 — Simples Nacional + faixa_faturamento + adicional semestral
  sheet.addRow({
    nome: 'Vital Solucoes LTDA',
    regime_tributario: 'simples_nacional',
    modo_cobranca: 'faixa_faturamento',
    pagador_tipo: 'PJ',
    pagador_documento: '55444333000100',
    pagador_nome: 'Vital Solucoes LTDA',
    email: 'financeiro@vital.com.br',
    whatsapp: '85977776666',
    cep: '60150000',
    logradouro: 'Rua Padre Valdevino',
    numero: '800',
    bairro: 'Aldeota',
    cidade: 'Fortaleza',
    uf: 'CE',
    conta_emissora: 'mc',
    regra_preco_forma: 'faixa_faturamento',
    regra_preco_limiar: 5000,
    regra_preco_valor_abaixo_limiar: 250,
    regra_preco_valor_acima_limiar: 480.56,
    adicional_ativo: 'sim',
    adicional_valor: 15000,
    adicional_intervalo_meses: 6,
    adicional_competencia_base: '2026-01',
  });

  const outPath = path.join(process.cwd(), 'public/templates/clientes-contabilidade-modelo.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Template XLSX gerado em', outPath);
}

main().catch(console.error);
