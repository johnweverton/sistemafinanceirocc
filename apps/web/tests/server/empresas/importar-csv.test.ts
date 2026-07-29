// Testes do parsing de CSV de importação de empresas de agrupamento (Story 10.4a).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv, parseExcel } from '@/server/csv/planilha-import';
import { rowToInput } from '@/server/csv/empresas-import';
import { novaEmpresaSchema } from '@/server/validation/empresa-schema';

const COLUNAS = [
  'nome', 'pagador_tipo', 'pagador_documento', 'pagador_nome', 'email', 'whatsapp', 'cep',
  'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'conta_emissora',
  'dias_vencimento', 'multa_percent', 'juros_mes_percent', 'desconto_percent', 'desconto_dias',
  'regra_preco_forma', 'regra_preco_base', 'regra_preco_limiar', 'regra_preco_taxa',
  'regra_preco_valor_fixo',
] as const;

function parseUma(campos: Partial<Record<(typeof COLUNAS)[number], string>>) {
  const header = COLUNAS.join(',');
  const linha = COLUNAS.map((c) => campos[c] ?? '').join(',');
  const rows = parseCsv(`${header}\n${linha}`);
  return rowToInput(rows[0]!);
}

describe('importação CSV — empresas', () => {
  it('linha só com nome importa a empresa sem blocos opcionais', () => {
    const input = parseUma({ nome: 'MEDISA LTDA' });
    expect('cobranca' in input).toBe(false);
    expect('condicoes' in input).toBe(false);
    expect('regraPreco' in input).toBe(false);
    expect(novaEmpresaSchema.safeParse(input).success).toBe(true);
  });

  it('linha com cobrança PJ válida é aceita', () => {
    const input = parseUma({
      nome: 'MEDISA LTDA', pagador_tipo: 'PJ', pagador_documento: '12345678000199',
      pagador_nome: 'MEDISA LTDA', email: 'contato@medisa.com.br', whatsapp: '85999998888',
      cep: '60110000', logradouro: 'Av Beira Mar', numero: '2000', bairro: 'Meireles',
      cidade: 'Fortaleza', uf: 'CE',
    });
    const parsed = novaEmpresaSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cobranca?.pagadorTipo).toBe('PJ');
      expect(parsed.data.cobranca?.whatsapp).toBe('85999998888');
    }
  });

  it('regra_preco por_guia é aceita (empresa não tem modo_cobranca — regra é direta)', () => {
    const input = parseUma({ nome: 'MEDISA LTDA', regra_preco_forma: 'por_guia', regra_preco_taxa: '6.41' });
    const parsed = novaEmpresaSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.regraPreco?.taxa).toBe(6.41);
  });

  it('overrides comerciais (condicoes) são montados quando preenchidos', () => {
    const input = parseUma({ nome: 'MEDISA LTDA', dias_vencimento: '10', multa_percent: '2' });
    const parsed = novaEmpresaSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.condicoes?.diasVencimento).toBe(10);
      expect(parsed.data.condicoes?.multaPercent).toBe(2);
    }
  });
});

describe('template público empresas-modelo.csv', () => {
  it('toda linha de exemplo é aceita pelo schema', () => {
    const caminho = resolve(__dirname, '../../../public/templates/empresas-modelo.csv');
    const texto = readFileSync(caminho, 'utf8');
    const rows = parseCsv(texto);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const input = rowToInput(row);
      const parsed = novaEmpresaSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Linha do template (${row.nome}) reprovada: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }
  });
});

describe('template público empresas-modelo.xlsx', () => {
  it('toda linha de exemplo é aceita pelo schema (mesmas colunas do CSV)', async () => {
    const caminho = resolve(__dirname, '../../../public/templates/empresas-modelo.xlsx');
    const buffer = readFileSync(caminho);
    const rows = await parseExcel(buffer);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const input = rowToInput(row);
      const parsed = novaEmpresaSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Linha do template XLSX (${row.nome}) reprovada: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }
  });
});
