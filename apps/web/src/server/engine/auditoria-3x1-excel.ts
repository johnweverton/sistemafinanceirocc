// Exportação em Excel da auditoria visual da regra 3x1 (achado 2026-09-04) — Dra. Emilie:
// contagem manual do dono deu 59 guias, o sistema deu 69, uma segunda conferência manual deu
// 61 — três números diferentes, sem forma de ver ONDE o agrupamento divergia da contagem
// manual item a item. Esta planilha lista cada procedimento bruto com uma marcação de qual
// "guia" (grupo de até 3) ele foi somado, pra o gestor financeiro conferir visualmente.
//
// Construída SOBRE `detalharContagemGuias` (contagem-producao.ts) — nunca reimplementa o
// agrupamento: a planilha só tem valor probatório se NUNCA puder divergir do valor
// efetivamente cobrado (reimplementar a lógica separadamente pra "explicar" o número já
// calculado recriaria o problema que motivou esta feature).
import ExcelJS from 'exceljs';
import type { ItemProducao } from '@cobranca/shared';
import { detalharContagemGuias, itensValidos } from './contagem-producao';

/** De qual lote de produção o item veio — rótulo exibido na planilha. Cateter/Fístula do
 *  Angiologista são sempre 1x1 (nunca passam por `detalharContagemGuias`, mesma separação que
 *  `processar-medico.ts` já faz entre `processarMedico`/`processarAngiologista`). */
export type OrigemBucketAuditoria =
  | 'Lote principal'
  | 'Outros Hospitais'
  | 'Imobilizações'
  | 'Angiografia'
  | 'Cateter'
  | 'Fístula';

export type TipoLinhaAuditoria = 'grupo3x1' | 'excecao' | 'individual1x1';

export interface LinhaAuditoria {
  bucket: OrigemBucketAuditoria;
  item: ItemProducao;
  tipoLinha: TipoLinhaAuditoria;
  /** 1-based, ordem de primeira ocorrência do grupo DENTRO do bucket+ramo — null só para
   *  individual1x1 (nada a agrupar). Não é o número da guia cobrada. */
  grupoSequencia: number | null;
  /** guias que o grupo deste item gerou — 1 pra exceção/individual1x1, teto(n/3) pra grupo3x1. */
  guiasDoGrupo: number;
  /** Chave ÚNICA por grupo real em TODO o workbook (bucket-qualificada, nunca colide entre
   *  buckets diferentes) — usada internamente pra decidir cor de fundo e pro resumo. Não é uma
   *  coluna visível na planilha (redundante com Bucket+Tipo+Grupo). */
  grupoChave: string;
}

function linhasDeBucket3x1(
  itens: ItemProducao[],
  especialidade: string | null | undefined,
  bucket: OrigemBucketAuditoria,
): { linhas: LinhaAuditoria[]; invalidos: ItemProducao[] } {
  const { itensDetalhados, itensInvalidos } = detalharContagemGuias(itens, especialidade);
  const linhas: LinhaAuditoria[] = itensDetalhados.map((d) => ({
    bucket,
    item: d.item,
    tipoLinha: d.ramo === 'excecao' ? 'excecao' : 'grupo3x1',
    grupoSequencia: d.grupoSequencia,
    guiasDoGrupo: d.guiasDoGrupo,
    grupoChave: `${bucket}|${d.grupoId}`,
  }));
  return { linhas, invalidos: itensInvalidos };
}

function linhasDeBucket1x1(
  itens: ItemProducao[],
  bucket: OrigemBucketAuditoria,
): { linhas: LinhaAuditoria[]; invalidos: ItemProducao[] } {
  const { validos, invalidos } = itensValidos(itens);
  const linhas: LinhaAuditoria[] = validos.map((item, i) => ({
    bucket,
    item,
    tipoLinha: 'individual1x1',
    grupoSequencia: null,
    guiasDoGrupo: 1,
    grupoChave: `${bucket}|individual|${i}`,
  }));
  return { linhas, invalidos };
}

export interface BucketsItensAuditoria {
  lotePrincipal?: ItemProducao[];
  outrosHospitais?: ItemProducao[];
  imobilizacoes?: ItemProducao[];
  angiografia?: ItemProducao[];
  cateter?: ItemProducao[];
  fistula?: ItemProducao[];
}

const BUCKETS_3X1: Array<{ key: keyof BucketsItensAuditoria; label: OrigemBucketAuditoria }> = [
  { key: 'lotePrincipal', label: 'Lote principal' },
  { key: 'outrosHospitais', label: 'Outros Hospitais' },
  { key: 'imobilizacoes', label: 'Imobilizações' },
  { key: 'angiografia', label: 'Angiografia' },
];
const BUCKETS_1X1: Array<{ key: keyof BucketsItensAuditoria; label: OrigemBucketAuditoria }> = [
  { key: 'cateter', label: 'Cateter' },
  { key: 'fistula', label: 'Fístula' },
];

export interface LinhasAuditoria {
  linhas: LinhaAuditoria[];
  invalidos: Array<{ bucket: OrigemBucketAuditoria; item: ItemProducao }>;
}

/**
 * Monta as linhas de auditoria de TODOS os buckets de um médico — orquestra qual função usar
 * por bucket (3x1 com agrupamento real vs. 1x1 sem agrupamento nenhum). `detalharContagemGuias`
 * só sabe resolver a semântica 3x1; a mistura de buckets heterogêneos fica aqui, mesma
 * separação de responsabilidade que `processar-medico.ts` já usa entre `processarMedico`/
 * `processarAngiologista`. Buckets ausentes/vazios são ignorados silenciosamente (médico normal
 * não tem Angiografia/Cateter/Fístula, por exemplo).
 */
export function montarLinhasAuditoria(buckets: BucketsItensAuditoria, especialidade?: string | null): LinhasAuditoria {
  const linhas: LinhaAuditoria[] = [];
  const invalidos: Array<{ bucket: OrigemBucketAuditoria; item: ItemProducao }> = [];

  for (const { key, label } of BUCKETS_3X1) {
    const itens = buckets[key];
    if (!itens || itens.length === 0) continue;
    const r = linhasDeBucket3x1(itens, especialidade, label);
    linhas.push(...r.linhas);
    invalidos.push(...r.invalidos.map((item) => ({ bucket: label, item })));
  }
  for (const { key, label } of BUCKETS_1X1) {
    const itens = buckets[key];
    if (!itens || itens.length === 0) continue;
    const r = linhasDeBucket1x1(itens, label);
    linhas.push(...r.linhas);
    invalidos.push(...r.invalidos.map((item) => ({ bucket: label, item })));
  }

  return { linhas, invalidos };
}

export interface ResumoAuditoria {
  medicoNome: string;
  competencia: string;
  /** Guias já gravadas no resultado (o valor efetivamente cobrado). Pode divergir do total
   *  calculado a partir dos itens ATUAIS da origem por dois motivos LEGÍTIMOS (nunca tratados
   *  como erro): saldo acumulado de competência anterior, ou contagem manual por planilha. */
  guiasResultado: number;
  /** `saldoAcumulado.guiasPrincipal` no momento da execução, se > 0 (achado da revisão de
   *  arquitetura: sem isso, todo médico com saldo retido geraria falso alarme de divergência). */
  guiasAcumuladasAntes?: number;
  /** Preenchido quando o resultado veio de contagem manual por planilha (migration 0058) — o
   *  motivo já gravado na seleção, mesmo texto do alerta "CONTAGEM MANUAL" do relatório. */
  guiasManuaisMotivo?: string | null;
}

const PALETA_GRUPOS: readonly string[] = [
  'FFD9E8FB', // azul claro
  'FFDDF3DD', // verde claro
  'FFFCF3CF', // amarelo claro
  'FFEBDFF7', // roxo claro
  'FFFCE4D6', // laranja claro
];
/** Cor FIXA fora do ciclo — reconhecível em qualquer posição da planilha, reforça a coluna
 *  "Tipo" (nunca depender só da cor: um grupo 3x1 legítimo de 1 item só é visualmente igual a
 *  uma exceção se a cor for o único sinal). */
const COR_EXCECAO = 'FFF9D6D5';

const TIPO_LABEL: Record<TipoLinhaAuditoria, string> = {
  grupo3x1: '3x1 (grupo)',
  excecao: 'Exceção (guia individual)',
  individual1x1: '1x1 (sem agrupamento)',
};

const COLUNAS_DETALHE = [
  { header: 'Bucket', key: 'bucket', width: 16 },
  { header: 'Data', key: 'data', width: 12 },
  { header: 'Paciente', key: 'paciente', width: 28 },
  { header: 'Senha', key: 'senha', width: 16 },
  { header: 'Código', key: 'codigo', width: 14 },
  { header: 'Descrição', key: 'descricao', width: 36 },
  { header: 'Tipo', key: 'tipo', width: 24 },
  { header: 'Guias do grupo', key: 'guiasDoGrupo', width: 14 },
] as const;

/**
 * Gera o .xlsx da auditoria — 3 abas: "Detalhe" (1 linha por item, cor de fundo por grupo —
 * `paletaIndex = (grupoSequencia-1) % N` garante que grupos consecutivos nunca compartilham
 * cor, sem precisar olhar o grupo anterior), "Não contabilizados" (itens sem paciente/data,
 * nunca somem em silêncio — só criada quando existe pelo menos 1) e "Resumo" (total calculado
 * por bucket vs. valor gravado, com as notas de saldo acumulado/contagem manual quando cabível).
 */
export async function gerarAuditoria3x1Excel(dados: LinhasAuditoria, resumo: ResumoAuditoria): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const detalheSheet = workbook.addWorksheet('Detalhe');
  detalheSheet.columns = COLUNAS_DETALHE.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  detalheSheet.getRow(1).font = { bold: true };

  const corPorGrupoChave = new Map<string, string>();
  let proximoIndiceCor = 0;
  function corDaLinha(l: LinhaAuditoria): string | null {
    if (l.tipoLinha === 'excecao') return COR_EXCECAO;
    if (l.tipoLinha === 'individual1x1') return null; // sem agrupamento real — fill neutro
    const existente = corPorGrupoChave.get(l.grupoChave);
    if (existente) return existente;
    const cor = PALETA_GRUPOS[proximoIndiceCor % PALETA_GRUPOS.length]!;
    proximoIndiceCor += 1;
    corPorGrupoChave.set(l.grupoChave, cor);
    return cor;
  }

  for (const l of dados.linhas) {
    const row = detalheSheet.addRow({
      bucket: l.bucket,
      data: l.item.data,
      paciente: l.item.pacienteNome,
      senha: l.item.atendimentoExternoId ?? '',
      codigo: l.item.codigoProcedimento,
      descricao: l.item.descricaoProcedimento ?? '',
      tipo: TIPO_LABEL[l.tipoLinha],
      guiasDoGrupo: l.guiasDoGrupo,
    });
    const cor = corDaLinha(l);
    if (cor) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
      });
    }
  }

  // Itens sem paciente/data — mesma regra de descarte do motor (`itensValidos`), nunca somem em
  // silêncio (mesmo princípio de `alertasDescarte` em `processar-medico.ts`).
  if (dados.invalidos.length > 0) {
    const invalidosSheet = workbook.addWorksheet('Não contabilizados');
    invalidosSheet.columns = [
      { header: 'Bucket', key: 'bucket', width: 16 },
      { header: 'Data', key: 'data', width: 12 },
      { header: 'Paciente', key: 'paciente', width: 28 },
      { header: 'Código', key: 'codigo', width: 14 },
      { header: 'Descrição', key: 'descricao', width: 36 },
      { header: 'Motivo', key: 'motivo', width: 44 },
    ];
    invalidosSheet.getRow(1).font = { bold: true };
    for (const { bucket, item } of dados.invalidos) {
      invalidosSheet.addRow({
        bucket,
        data: item.data || '(sem data)',
        paciente: item.pacienteNome || '(sem paciente)',
        codigo: item.codigoProcedimento,
        descricao: item.descricaoProcedimento ?? '',
        motivo: 'Sem paciente ou sem data — descartado da contagem (mesma regra do motor).',
      });
    }
  }

  const resumoSheet = workbook.addWorksheet('Resumo');
  resumoSheet.columns = [
    { header: 'Item', key: 'item', width: 40 },
    { header: 'Valor', key: 'valor', width: 70 },
  ];
  resumoSheet.getRow(1).font = { bold: true };
  resumoSheet.addRow({ item: 'Médico', valor: resumo.medicoNome });
  resumoSheet.addRow({ item: 'Competência', valor: resumo.competencia });

  // Total calculado por bucket — soma de guiasDoGrupo por grupoChave ÚNICA (nunca por linha,
  // vários itens do mesmo grupo compartilham o mesmo guiasDoGrupo).
  const guiasPorBucket = new Map<OrigemBucketAuditoria, Map<string, number>>();
  for (const l of dados.linhas) {
    let porGrupo = guiasPorBucket.get(l.bucket);
    if (!porGrupo) {
      porGrupo = new Map<string, number>();
      guiasPorBucket.set(l.bucket, porGrupo);
    }
    if (!porGrupo.has(l.grupoChave)) porGrupo.set(l.grupoChave, l.guiasDoGrupo);
  }
  let totalCalculado = 0;
  for (const [bucket, porGrupo] of guiasPorBucket) {
    let totalBucket = 0;
    for (const g of porGrupo.values()) totalBucket += g;
    totalCalculado += totalBucket;
    resumoSheet.addRow({ item: `Guias calculadas — ${bucket}`, valor: totalBucket });
  }
  resumoSheet.addRow({ item: 'Total calculado (itens ATUAIS da origem)', valor: totalCalculado });
  resumoSheet.addRow({ item: 'Guias gravadas na execução (valor cobrado)', valor: resumo.guiasResultado });

  // Achado da revisão de arquitetura: `guiasResultado` pode incluir saldo acumulado de
  // competência anterior (não presente nos itens desta planilha, buscados da origem ATUAL) ou
  // vir de contagem manual (pula o agrupamento automático por completo) — as duas situações são
  // divergência ESPERADA, não erro, e precisam de nota explícita pra não virar alarme falso.
  const temSaldoAcumulado = Boolean(resumo.guiasAcumuladasAntes && resumo.guiasAcumuladasAntes > 0);
  if (temSaldoAcumulado) {
    resumoSheet.addRow({
      item: 'Nota',
      valor:
        `O valor gravado inclui ${resumo.guiasAcumuladasAntes} guia(s) acumulada(s) de competência(s) ` +
        'anterior(es), que NÃO aparecem nos itens desta planilha (buscada da origem ATUAL) — ' +
        'divergência esperada, não é erro.',
    });
  }
  if (resumo.guiasManuaisMotivo) {
    resumoSheet.addRow({
      item: 'Nota',
      valor:
        `O valor gravado veio de contagem MANUAL por planilha (motivo: ${resumo.guiasManuaisMotivo}), ` +
        'não do agrupamento automático — divergência contra o total calculado aqui é esperada.',
    });
  } else if (!temSaldoAcumulado && totalCalculado !== resumo.guiasResultado) {
    resumoSheet.addRow({
      item: 'ALERTA',
      valor:
        'O total calculado com os itens ATUAIS da origem diverge do valor gravado na execução — ' +
        'a produção pode ter mudado na origem desde a execução original.',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
