// Testes do parsing de CSV de importação de clientes de contabilidade (Epic 11).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv, parseExcel } from '@/server/csv/planilha-import';
import { rowToInput } from '@/server/csv/clientes-contabilidade-import';
import { novoClienteContabilidadeSchema } from '@/server/validation/cliente-contabilidade-schema';

const COLUNAS = [
  'nome', 'regime_tributario', 'modo_cobranca',
  'pagador_tipo', 'pagador_documento', 'pagador_nome', 'email', 'whatsapp', 'cep',
  'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'conta_emissora',
  'dias_vencimento', 'multa_percent', 'juros_mes_percent', 'desconto_percent', 'desconto_dias',
  'regra_preco_forma', 'regra_preco_base', 'regra_preco_limiar', 'regra_preco_taxa',
  'regra_preco_valor_fixo', 'regra_preco_valor_abaixo_limiar', 'regra_preco_valor_acima_limiar',
  'adicional_ativo', 'adicional_valor', 'adicional_intervalo_meses', 'adicional_competencia_base',
] as const;

function parseUma(campos: Partial<Record<(typeof COLUNAS)[number], string>>) {
  const header = COLUNAS.join(',');
  const linha = COLUNAS.map((c) => campos[c] ?? '').join(',');
  const rows = parseCsv(`${header}\n${linha}`);
  return rowToInput(rows[0]!);
}

describe('importação CSV — clientes contabilidade', () => {
  it('linha mínima (nome + regime + modo) é aceita', () => {
    const input = parseUma({
      nome: 'Padaria Ltda',
      regime_tributario: 'lucro_presumido',
      modo_cobranca: 'fixo',
      regra_preco_forma: 'fixo',
      regra_preco_valor_fixo: '800',
    });
    expect('cobranca' in input).toBe(false);
    const parsed = novoClienteContabilidadeSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it('linha com cobrança PJ é aceita', () => {
    const input = parseUma({
      nome: 'Padaria Ltda',
      regime_tributario: 'lucro_presumido',
      modo_cobranca: 'fixo',
      regra_preco_forma: 'fixo',
      regra_preco_valor_fixo: '800',
      pagador_tipo: 'PJ',
      pagador_documento: '11222333000181',
      pagador_nome: 'Padaria Ltda',
      email: 'contato@padaria.com.br',
      whatsapp: '85999998888',
      cep: '60110000',
      logradouro: 'Rua do Trigo',
      numero: '50',
      bairro: 'Meireles',
      cidade: 'Fortaleza',
      uf: 'CE',
    });
    const parsed = novoClienteContabilidadeSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cobranca?.pagadorTipo).toBe('PJ');
    }
  });

  it('regra de preço faixa_faturamento com limiar+abaixo+acima é aceita', () => {
    const input = parseUma({
      nome: 'Padaria Ltda',
      regime_tributario: 'simples_nacional',
      modo_cobranca: 'faixa_faturamento',
      regra_preco_forma: 'faixa_faturamento',
      regra_preco_limiar: '5000',
      regra_preco_valor_abaixo_limiar: '250',
      regra_preco_valor_acima_limiar: '480.56',
    });
    const parsed = novoClienteContabilidadeSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.regraPreco?.valorAbaixoLimiar).toBe(250);
      expect(parsed.data.regraPreco?.valorAcimaLimiar).toBe(480.56);
    }
  });

  it('regra de preço fixo com valor_fixo é aceita', () => {
    const input = parseUma({
      nome: 'Clinica X',
      regime_tributario: 'lucro_presumido',
      modo_cobranca: 'fixo',
      regra_preco_forma: 'fixo',
      regra_preco_valor_fixo: '800',
    });
    const parsed = novoClienteContabilidadeSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.regraPreco?.valorFixo).toBe(800);
    }
  });

  it('overrides comerciais (condições) são montados quando preenchidos', () => {
    const input = parseUma({
      nome: 'Clinica Y',
      regime_tributario: 'lucro_presumido',
      modo_cobranca: 'fixo',
      regra_preco_forma: 'fixo',
      regra_preco_valor_fixo: '800',
      dias_vencimento: '10',
      multa_percent: '2',
    });
    const parsed = novoClienteContabilidadeSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.condicoes?.diasVencimento).toBe(10);
      expect(parsed.data.condicoes?.multaPercent).toBe(2);
    }
  });

  it('adicional semestral ativo exige valor+intervalo+competência base', () => {
    const input = parseUma({
      nome: 'Vital LTDA',
      regime_tributario: 'simples_nacional',
      modo_cobranca: 'faixa_faturamento',
      regra_preco_forma: 'faixa_faturamento',
      regra_preco_limiar: '5000',
      regra_preco_valor_abaixo_limiar: '250',
      regra_preco_valor_acima_limiar: '480.56',
      adicional_ativo: 'sim',
      adicional_valor: '15000',
      adicional_intervalo_meses: '6',
      adicional_competencia_base: '2026-01',
    });
    const parsed = novoClienteContabilidadeSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.adicionalAtivo).toBe(true);
      expect(parsed.data.adicionalValor).toBe(15000);
      expect(parsed.data.adicionalIntervaloMeses).toBe(6);
    }
  });

  it('adicional ativo sem valor é reprovado', () => {
    const input = parseUma({
      nome: 'Vital LTDA',
      regime_tributario: 'simples_nacional',
      modo_cobranca: 'faixa_faturamento',
      regra_preco_forma: 'faixa_faturamento',
      adicional_ativo: 'sim',
    });
    const parsed = novoClienteContabilidadeSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });
});

describe('template público clientes-contabilidade-modelo.csv', () => {
  it('toda linha de exemplo é aceita pelo schema', () => {
    const caminho = resolve(__dirname, '../../../public/templates/clientes-contabilidade-modelo.csv');
    const texto = readFileSync(caminho, 'utf8');
    const rows = parseCsv(texto);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const input = rowToInput(row);
      const parsed = novoClienteContabilidadeSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Linha do template (${row.nome}) reprovada: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }
  });
});

describe('template público clientes-contabilidade-modelo.xlsx', () => {
  it('toda linha de exemplo é aceita pelo schema (mesmas colunas do CSV)', async () => {
    const caminho = resolve(__dirname, '../../../public/templates/clientes-contabilidade-modelo.xlsx');
    const buffer = readFileSync(caminho);
    const rows = await parseExcel(buffer);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const input = rowToInput(row);
      const parsed = novoClienteContabilidadeSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Linha do template XLSX (${row.nome}) reprovada: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }
  });
});
