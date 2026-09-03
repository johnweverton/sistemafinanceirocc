// Garante que o template público de guias manuais (baixado pelo operador na tela de nova emissão)
// continua sincronizado com o parser — mesmo espírito de template-medicos.test.ts: o template já
// divergiu do parser no passado (coluna lida pelo código e ausente do CSV), e aqui o custo seria
// pior: o operador prepararia a planilha do jeito errado num dado que muda o valor cobrado.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Medico } from '@cobranca/shared';
import {
  parseCsv,
  parseExcel,
  resolverGuiasManuais,
  normalizarCpf,
  COLUNAS_GUIAS_MANUAIS,
} from '@/server/csv/guias-manuais-import';

/** Cadastro fake com os MESMOS CPFs do template — o cruzamento é sempre por CPF. */
function cadastroDoTemplate(rows: Record<string, string>[]): Medico[] {
  return rows.map(
    (row, i) =>
      ({
        id: `med-${i}`,
        nome: row.nome ?? `Médico ${i}`,
        cpf: normalizarCpf(row.cpf),
        especialidade: 'Urologia',
        statusHapvida: 'credenciado',
        fazOutrosHospitais: false,
        fazImobilizacoes: false,
        modoMudancaData: 'nao',
        modoCobranca: 'faixa_guias',
        percentualProducao: null,
        regraPreco: null,
        semExcedentePorGuia: false,
        contaEmissora: 'mc',
        colaboradorResponsavel: null,
        ativo: true,
        necessitaConfiguracao: false,
        externalId: `ext-${i}`,
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-01T00:00:00Z',
      }) as Medico,
  );
}

function conferir(rows: Record<string, string>[], origem: string) {
  expect(rows.length, `${origem} sem linhas de exemplo`).toBeGreaterThan(0);

  for (const coluna of COLUNAS_GUIAS_MANUAIS) {
    expect(Object.keys(rows[0]!), `${origem} sem a coluna "${coluna}"`).toContain(coluna);
  }

  // Todas as linhas do template usam a mesma competência de exemplo.
  const competencia = rows[0]!.competencia!;
  const { linhas, erros } = resolverGuiasManuais(rows, cadastroDoTemplate(rows), competencia);
  if (erros.length > 0) {
    throw new Error(`${origem} reprovado: ${erros.map((e) => `linha ${e.linha}: ${e.erro}`).join('; ')}`);
  }
  expect(linhas).toHaveLength(rows.length);
}

describe('template público guias-manuais-modelo', () => {
  it('CSV: toda linha de exemplo é aceita pelo parser', () => {
    const caminho = resolve(__dirname, '../../../public/templates/guias-manuais-modelo.csv');
    conferir(parseCsv(readFileSync(caminho, 'utf8')), 'guias-manuais-modelo.csv');
  });

  it('XLSX: mesmas colunas e mesmas linhas do CSV', async () => {
    const caminho = resolve(__dirname, '../../../public/templates/guias-manuais-modelo.xlsx');
    const rows = await parseExcel(readFileSync(caminho));
    conferir(rows, 'guias-manuais-modelo.xlsx');

    // O Excel adora transformar CPF em número (come o zero à esquerda) e "2026-06" em data — o
    // gerador marca as duas colunas como texto justamente por isso. Se alguém mexer no gerador e
    // perder o numFmt '@', este teste cai antes de a planilha errada chegar no operador.
    const csv = parseCsv(
      readFileSync(resolve(__dirname, '../../../public/templates/guias-manuais-modelo.csv'), 'utf8'),
    );
    expect(rows.map((r) => r.cpf)).toEqual(csv.map((r) => r.cpf));
    expect(rows.map((r) => r.competencia)).toEqual(csv.map((r) => r.competencia));
  });
});
