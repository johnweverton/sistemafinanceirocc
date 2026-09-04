// Testes da auditoria visual da regra 3x1 (achado 2026-09-04, Dra. Emilie: contagem manual deu
// 59, sistema deu 69, segunda conferência manual deu 61). Reabre o buffer com ExcelJS para
// validar conteúdo/cores real, não só que o buffer não está vazio.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import type { ItemProducao } from '@cobranca/shared';
import {
  montarLinhasAuditoria,
  gerarAuditoria3x1Excel,
  type BucketsItensAuditoria,
} from '../../../src/server/engine/auditoria-3x1-excel';

function item(overrides: Partial<ItemProducao> = {}): ItemProducao {
  return {
    data: '2026-08-06',
    pacienteNome: 'João Silva',
    atendimentoExternoId: null,
    codigoProcedimento: '10101012',
    descricaoProcedimento: 'Consulta',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
    ...overrides,
  };
}

function corDaCelula(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (!fill || fill.type !== 'pattern') return undefined;
  const fg = fill.fgColor as { argb?: string } | undefined;
  return fg?.argb;
}

describe('montarLinhasAuditoria', () => {
  it('lote principal (grupo 3x1 de 3 itens + 1 exceção + 1 grupo de 1) + Outros Hospitais (grupo de 4 → teto=2)', () => {
    const buckets: BucketsItensAuditoria = {
      lotePrincipal: [
        item({ pacienteNome: 'Grupo A', codigoProcedimento: '3.11.02.03-4' }), // exceção
        item({ pacienteNome: 'Grupo B' }),
        item({ pacienteNome: 'Grupo B' }),
        item({ pacienteNome: 'Grupo B' }), // grupo3x1 de 3 → 1 guia
        item({ pacienteNome: 'Grupo C' }), // grupo de 1 → 1 guia
      ],
      outrosHospitais: [
        item({ pacienteNome: 'Grupo D' }),
        item({ pacienteNome: 'Grupo D' }),
        item({ pacienteNome: 'Grupo D' }),
        item({ pacienteNome: 'Grupo D' }), // grupo3x1 de 4 → teto(4/3)=2
      ],
    };
    const { linhas, invalidos } = montarLinhasAuditoria(buckets, 'Urologista');
    expect(linhas).toHaveLength(9);
    expect(invalidos).toHaveLength(0);
    expect(linhas.filter((l) => l.bucket === 'Lote principal')).toHaveLength(5);
    expect(linhas.filter((l) => l.bucket === 'Outros Hospitais')).toHaveLength(4);
    expect(linhas.filter((l) => l.tipoLinha === 'excecao')).toHaveLength(1);
  });

  it('Angiologista: Cateter/Fístula 1x1 (sem grupo real) + Angiografia com exceção + grupo 3x1', () => {
    const buckets: BucketsItensAuditoria = {
      cateter: [item({ pacienteNome: 'P1' }), item({ pacienteNome: 'P2' }), item({ pacienteNome: 'P3' })],
      fistula: [item({ pacienteNome: 'P4' }), item({ pacienteNome: 'P5' })],
      angiografia: [
        item({ pacienteNome: 'P6', codigoProcedimento: '4.09.02.05-6' }), // exceção
        item({ pacienteNome: 'P7' }),
        item({ pacienteNome: 'P7' }),
        item({ pacienteNome: 'P7' }),
      ],
    };
    const { linhas } = montarLinhasAuditoria(buckets, 'Angiologista');
    const cateter = linhas.filter((l) => l.bucket === 'Cateter');
    const fistula = linhas.filter((l) => l.bucket === 'Fístula');
    const angiografia = linhas.filter((l) => l.bucket === 'Angiografia');

    expect(cateter).toHaveLength(3);
    expect(cateter.every((l) => l.tipoLinha === 'individual1x1' && l.grupoSequencia === null)).toBe(true);
    expect(fistula).toHaveLength(2);
    expect(fistula.every((l) => l.tipoLinha === 'individual1x1')).toBe(true);

    expect(angiografia).toHaveLength(4);
    expect(angiografia.filter((l) => l.tipoLinha === 'excecao')).toHaveLength(1);
    expect(angiografia.filter((l) => l.tipoLinha === 'grupo3x1')).toHaveLength(3);
  });

  it('itens inválidos (sem paciente/data) vão para `invalidos`, nunca somem em silêncio', () => {
    const buckets: BucketsItensAuditoria = {
      lotePrincipal: [item({ pacienteNome: 'Válido' }), item({ data: '' }), item({ pacienteNome: '' })],
    };
    const { linhas, invalidos } = montarLinhasAuditoria(buckets, 'Pediatria');
    expect(linhas).toHaveLength(1);
    expect(invalidos).toHaveLength(2);
    expect(invalidos.every((i) => i.bucket === 'Lote principal')).toBe(true);
  });

  it('buckets ausentes/vazios são ignorados silenciosamente', () => {
    const { linhas, invalidos } = montarLinhasAuditoria({}, 'Pediatria');
    expect(linhas).toHaveLength(0);
    expect(invalidos).toHaveLength(0);
  });
});

describe('gerarAuditoria3x1Excel', () => {
  it('gera um buffer não vazio', async () => {
    const { linhas, invalidos } = montarLinhasAuditoria(
      { lotePrincipal: [item(), item(), item()] },
      'Pediatria',
    );
    const buffer = await gerarAuditoria3x1Excel(
      { linhas, invalidos },
      { medicoNome: 'Dra. Emilie', competencia: '2026-08', guiasResultado: 1 },
    );
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('linhas do MESMO grupo têm a mesma cor de fundo; a primeira linha do PRÓXIMO grupo tem cor diferente', async () => {
    const buckets: BucketsItensAuditoria = {
      lotePrincipal: [
        item({ pacienteNome: 'Grupo A' }),
        item({ pacienteNome: 'Grupo A' }),
        item({ pacienteNome: 'Grupo A' }),
        item({ pacienteNome: 'Grupo B' }),
        item({ pacienteNome: 'Grupo B' }),
      ],
    };
    const dados = montarLinhasAuditoria(buckets, 'Pediatria');
    const buffer = await gerarAuditoria3x1Excel(dados, {
      medicoNome: 'Dra. Emilie',
      competencia: '2026-08',
      guiasResultado: 2,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Detalhe')!;

    // Linha 1 = cabeçalho; linhas 2-4 = Grupo A, linhas 5-6 = Grupo B.
    const corA1 = corDaCelula(sheet.getRow(2).getCell(1));
    const corA2 = corDaCelula(sheet.getRow(3).getCell(1));
    const corA3 = corDaCelula(sheet.getRow(4).getCell(1));
    const corB1 = corDaCelula(sheet.getRow(5).getCell(1));
    const corB2 = corDaCelula(sheet.getRow(6).getCell(1));

    expect(corA1).toBeDefined();
    expect(corA1).toBe(corA2);
    expect(corA2).toBe(corA3);
    expect(corB1).toBe(corB2);
    expect(corB1).not.toBe(corA1);
  });

  it('linhas de exceção têm a cor fixa reservada, nunca a cor cíclica de nenhum grupo normal', async () => {
    const buckets: BucketsItensAuditoria = {
      lotePrincipal: [
        item({ pacienteNome: 'Normal', codigoProcedimento: '11111111' }),
        item({ pacienteNome: 'Normal', codigoProcedimento: '11111111' }),
        item({ pacienteNome: 'Excecao1', codigoProcedimento: '3.11.02.03-4' }),
        item({ pacienteNome: 'Excecao2', codigoProcedimento: '3.11.02.03-4' }),
      ],
    };
    const dados = montarLinhasAuditoria(buckets, 'Urologista');
    const buffer = await gerarAuditoria3x1Excel(dados, {
      medicoNome: 'Dr. Teste',
      competencia: '2026-08',
      guiasResultado: 3,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Detalhe')!;

    const corGrupoNormal = corDaCelula(sheet.getRow(2).getCell(1));
    const corExcecao1 = corDaCelula(sheet.getRow(4).getCell(1));
    const corExcecao2 = corDaCelula(sheet.getRow(5).getCell(1));

    expect(corExcecao1).toBe(corExcecao2); // exceções compartilham a MESMA cor fixa...
    expect(corExcecao1).not.toBe(corGrupoNormal); // ...mas nunca a de um grupo normal
  });

  it('Cateter/Fístula (1x1) não recebem cor de grupo (fill neutro)', async () => {
    const dados = montarLinhasAuditoria(
      { cateter: [item({ pacienteNome: 'P1' }), item({ pacienteNome: 'P2' })] },
      'Angiologista',
    );
    const buffer = await gerarAuditoria3x1Excel(dados, {
      medicoNome: 'Dr. Angio',
      competencia: '2026-08',
      guiasResultado: 2,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Detalhe')!;
    expect(corDaCelula(sheet.getRow(2).getCell(1))).toBeUndefined();
    expect(corDaCelula(sheet.getRow(3).getCell(1))).toBeUndefined();
  });

  it('itens inválidos aparecem na aba "Não contabilizados"; sem inválidos, a aba nem é criada', async () => {
    const comInvalidos = montarLinhasAuditoria(
      { lotePrincipal: [item(), item({ data: '' })] },
      'Pediatria',
    );
    const bufferComInvalidos = await gerarAuditoria3x1Excel(comInvalidos, {
      medicoNome: 'Dr. A',
      competencia: '2026-08',
      guiasResultado: 1,
    });
    const wbComInvalidos = new ExcelJS.Workbook();
    await wbComInvalidos.xlsx.load(bufferComInvalidos);
    expect(wbComInvalidos.getWorksheet('Não contabilizados')).toBeDefined();

    const semInvalidos = montarLinhasAuditoria({ lotePrincipal: [item()] }, 'Pediatria');
    const bufferSemInvalidos = await gerarAuditoria3x1Excel(semInvalidos, {
      medicoNome: 'Dr. A',
      competencia: '2026-08',
      guiasResultado: 1,
    });
    const wbSemInvalidos = new ExcelJS.Workbook();
    await wbSemInvalidos.xlsx.load(bufferSemInvalidos);
    expect(wbSemInvalidos.getWorksheet('Não contabilizados')).toBeUndefined();
  });

  it('resumo: total calculado por bucket bate com a soma manual esperada no fixture', async () => {
    const dados = montarLinhasAuditoria(
      {
        lotePrincipal: [item({ pacienteNome: 'A' }), item({ pacienteNome: 'A' }), item({ pacienteNome: 'A' })], // teto(3/3)=1
        outrosHospitais: [item({ pacienteNome: 'B' }), item({ pacienteNome: 'B' }), item({ pacienteNome: 'B' }), item({ pacienteNome: 'B' })], // teto(4/3)=2
      },
      'Ortopedista',
    );
    const buffer = await gerarAuditoria3x1Excel(dados, {
      medicoNome: 'Dr. Orto',
      competencia: '2026-08',
      guiasResultado: 3,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Resumo')!;

    const linhas: Array<[unknown, unknown]> = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      linhas.push([row.getCell(1).value, row.getCell(2).value]);
    });
    expect(linhas).toContainEqual(['Guias calculadas — Lote principal', 1]);
    expect(linhas).toContainEqual(['Guias calculadas — Outros Hospitais', 2]);
    expect(linhas).toContainEqual(['Total calculado (itens ATUAIS da origem)', 3]);
    expect(linhas).toContainEqual(['Guias gravadas na execução (valor cobrado)', 3]);
  });

  it('saldo acumulado: divergência entre total calculado e valor gravado vira NOTA explicativa, não ALERTA', async () => {
    const dados = montarLinhasAuditoria({ lotePrincipal: [item(), item()] }, 'Pediatria'); // 2 itens, 1 guia calculada
    const buffer = await gerarAuditoria3x1Excel(dados, {
      medicoNome: 'Dr. Saldo',
      competencia: '2026-08',
      guiasResultado: 6, // 1 (calculado) + 5 (saldo acumulado) — NÃO é erro
      guiasAcumuladasAntes: 5,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Resumo')!;
    const textos: string[] = [];
    sheet.eachRow((row) => {
      const valor = row.getCell(2).value;
      if (typeof valor === 'string') textos.push(valor);
    });
    expect(textos.some((t) => t.includes('acumulada'))).toBe(true);
    expect(textos.some((t) => t.startsWith('O total calculado') && t.includes('diverge'))).toBe(false);
  });

  it('contagem manual: divergência vira NOTA explicativa citando o motivo, não ALERTA', async () => {
    const dados = montarLinhasAuditoria({ lotePrincipal: [item(), item()] }, 'Pediatria');
    const buffer = await gerarAuditoria3x1Excel(dados, {
      medicoNome: 'Dr. Manual',
      competencia: '2026-08',
      guiasResultado: 59,
      guiasManuaisMotivo: 'contagem manual conferida pelo dono',
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Resumo')!;
    const textos: string[] = [];
    sheet.eachRow((row) => {
      const valor = row.getCell(2).value;
      if (typeof valor === 'string') textos.push(valor);
    });
    expect(textos.some((t) => t.includes('contagem manual conferida pelo dono'))).toBe(true);
  });

  it('sem saldo/manual: divergência real vira ALERTA explícito (produção mudou na origem)', async () => {
    const dados = montarLinhasAuditoria({ lotePrincipal: [item(), item()] }, 'Pediatria'); // calcula 1
    const buffer = await gerarAuditoria3x1Excel(dados, {
      medicoNome: 'Dr. Divergente',
      competencia: '2026-08',
      guiasResultado: 5, // divergente, sem explicação
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Resumo')!;
    const linhaAlerta = (() => {
      let achou: string | undefined;
      sheet.eachRow((row) => {
        if (row.getCell(1).value === 'ALERTA') achou = String(row.getCell(2).value);
      });
      return achou;
    })();
    expect(linhaAlerta).toBeDefined();
    expect(linhaAlerta).toContain('diverge');
  });
});
