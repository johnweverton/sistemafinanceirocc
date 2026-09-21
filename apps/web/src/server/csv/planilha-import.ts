// Parsing genérico de planilhas (CSV/Excel) para as rotas de importação em lote — médicos,
// empresas e clientes de contabilidade compartilham o mesmo parsing e o mesmo loop
// linha→input→validação→criação; só o `rowToInput`/schema/`criar` variam por domínio.
// Route files do Next não podem exportar funções além dos métodos HTTP, por isso o parsing
// fica em módulos separados (mesmo motivo do medicos-import.ts original).
import ExcelJS from 'exceljs';
import { ApiError } from '@/lib/api-error';

/**
 * Normaliza nome para comparação tolerante a acentuação/caixa/espaços — usada tanto para
 * resolver vínculos (ex.: empresa_grupo por nome) quanto para casar uma linha da planilha com
 * um registro já existente na reimportação (upsert por nome, ver `processarLinhas`).
 */
export function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0]) return [];
  // Auto-detecta o separador: conta vírgulas vs ponto-e-vírgulas no cabeçalho e usa o que
  // aparecer mais. CSVs gerados em PT-BR/locales europeus usam ';' por padrão (Excel, LibreOffice
  // salvos em "CSV separado por ponto-e-vírgula") — hardcodar ',' rejeita esses arquivos.
  const headerLine = lines[0];
  const nCommas = (headerLine.match(/,/g) ?? []).length;
  const nSemicolons = (headerLine.match(/;/g) ?? []).length;
  const sep = nSemicolons > nCommas ? ';' : ',';
  const headers = headerLine.split(sep).map((h) => h.trim().replace(/^\uFEFF/, ''));
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = line.split(sep).map((v) => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
    });
}

export async function parseExcel(buffer: Buffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: Record<string, string>[] = [];
  let headers: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell((cell, colNumber) => {
        headers[colNumber] = cell.text ? cell.text.toString().trim() : '';
      });
    } else {
      const rowData: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          rowData[header] = cell.text ? cell.text.toString().trim() : '';
        }
      });
      rows.push(rowData);
    }
  });

  return rows;
}

/**
 * Extrai e valida o arquivo enviado em `formData` (campo `arquivo`): tipo (.csv/.xlsx/.xls),
 * tamanho e nº de linhas. Comum às 3 rotas de import — cada uma decide seus próprios limites
 * (podem divergir no futuro por volume esperado de cada domínio).
 */
export async function extrairLinhasDoArquivo(
  formData: FormData,
  limites: { maxBytes: number; maxRows: number },
): Promise<Record<string, string>[]> {
  const file = formData.get('arquivo');
  if (!file || !(file instanceof File)) {
    throw new ApiError(422, 'Arquivo não enviado (campo: arquivo)', 'ARQUIVO_INVALIDO');
  }
  const nomeLower = file.name.toLowerCase();
  const isCsv = nomeLower.endsWith('.csv');
  const isExcel = nomeLower.endsWith('.xlsx') || nomeLower.endsWith('.xls');
  if (!isCsv && !isExcel) {
    throw new ApiError(422, 'Somente arquivos .csv ou .xlsx são aceitos', 'FORMATO_INVALIDO');
  }
  if (file.size > limites.maxBytes) {
    throw new ApiError(
      413,
      `Arquivo excede o limite de ${limites.maxBytes / (1024 * 1024)} MB`,
      'ARQUIVO_GRANDE',
    );
  }

  const rows = isCsv
    ? parseCsv(await file.text())
    : await parseExcel(Buffer.from(await file.arrayBuffer()));

  if (rows.length === 0) {
    throw new ApiError(422, 'Arquivo vazio ou sem linhas de dados após o cabeçalho', 'ARQUIVO_VAZIO');
  }
  if (rows.length > limites.maxRows) {
    throw new ApiError(413, `Arquivo excede o limite de ${limites.maxRows} linhas`, 'ARQUIVO_GRANDE');
  }
  return rows;
}

/**
 * Overrides comerciais (dias_vencimento, multa_percent, juros_mes_percent, desconto_percent,
 * desconto_dias — migration 0006) — bloco compartilhado por médicos/empresas/clientes de
 * contabilidade (mesmo `condicoesCobrancaSchema`). Só monta o bloco quando algum campo vem
 * preenchido na linha; se parcial/inválido, o schema de destino reprova e a linha entra em
 * `erros[]` (não aborta o lote).
 */
export function condicoesDaLinha(row: Record<string, string>): Record<string, unknown> {
  const temCondicoes =
    row.dias_vencimento || row.multa_percent || row.juros_mes_percent || row.desconto_percent || row.desconto_dias;
  if (!temCondicoes) return {};
  return {
    condicoes: {
      diasVencimento: row.dias_vencimento ? Number(row.dias_vencimento) : null,
      multaPercent: row.multa_percent ? Number(row.multa_percent) : null,
      jurosMesPercent: row.juros_mes_percent ? Number(row.juros_mes_percent) : null,
      descontoPercent: row.desconto_percent ? Number(row.desconto_percent) : null,
      descontoDias: row.desconto_dias ? Number(row.desconto_dias) : null,
    },
  };
}

/**
 * Regra de preço própria (migrations 0025/0027, mais valorAbaixoLimiar/valorAcimaLimiar da forma
 * `faixa_faturamento` do Épico 11) — bloco compartilhado pelos 3 domínios (mesmo
 * `regraPrecoSchema`). Repassa os campos crus: a coerência por forma (ex.: "por_guia" exige
 * taxa) já é validada pelo schema de destino, não aqui. `gateExtra` liga o bloco mesmo sem nenhum
 * campo regra_preco_* preenchido (ex.: médico com modo_cobranca=preco_proprio mas linha
 * incompleta — melhor virar erro de validação claro do que ser silenciosamente ignorado).
 */
export function regraPrecoDaLinha(row: Record<string, string>, gateExtra = false): Record<string, unknown> {
  const temRegra =
    gateExtra ||
    row.regra_preco_forma ||
    row.regra_preco_base ||
    row.regra_preco_limiar ||
    row.regra_preco_taxa ||
    row.regra_preco_valor_fixo ||
    row.regra_preco_valor_abaixo_limiar ||
    row.regra_preco_valor_acima_limiar;
  if (!temRegra) return {};
  return {
    regraPreco: {
      forma: row.regra_preco_forma,
      base: row.regra_preco_base ? Number(row.regra_preco_base) : null,
      limiar: row.regra_preco_limiar ? Number(row.regra_preco_limiar) : null,
      taxa: row.regra_preco_taxa ? Number(row.regra_preco_taxa) : null,
      valorFixo: row.regra_preco_valor_fixo ? Number(row.regra_preco_valor_fixo) : null,
      valorAbaixoLimiar: row.regra_preco_valor_abaixo_limiar ? Number(row.regra_preco_valor_abaixo_limiar) : null,
      valorAcimaLimiar: row.regra_preco_valor_acima_limiar ? Number(row.regra_preco_valor_acima_limiar) : null,
    },
  };
}

export interface ErroLinha {
  linha: number;
  /** Identificador legível da linha (CPF, CNPJ, nome...) — o que faz sentido em cada domínio. */
  chave: string;
  erro: string;
}

export interface ResultadoImportacao {
  criados: number;
  atualizados: number;
  erros: ErroLinha[];
}

interface SchemaLike<TSaida> {
  safeParse: (
    input: unknown,
  ) => { success: true; data: TSaida } | { success: false; error: { issues: { message: string }[] } };
}

/**
 * Loop comum de importação: linha → input (domínio) → validação (Zod) → upsert (repositório).
 * `rowToInput` pode lançar para reportar um problema de pré-validação (ex.: nome de empresa não
 * encontrado) — o erro vira uma entrada em `erros[]` como qualquer outra falha de linha, sem
 * abortar as demais.
 *
 * Achado do dono (2026-07-30): reimportar uma planilha (ex.: mesma base após corrigir erros
 * apontados na 1ª importação) sempre CRIAVA de novo, duplicando quem já tinha sido importado com
 * sucesso — nada aqui casava a linha com um registro existente. `encontrarExistenteId` é opcional
 * de propósito (nem todo domínio tem uma chave natural de match pronta), mas os 3 chamadores atuais
 * (médicos/empresas/clientes de contabilidade) sempre o informam: se a linha casar com um registro
 * já existente, atualiza em vez de criar.
 */
export async function processarLinhas<TInput, TSaida>(
  rows: Record<string, string>[],
  opts: {
    rowToInput: (row: Record<string, string>) => TInput;
    schema: SchemaLike<TSaida>;
    criar: (data: TSaida) => Promise<{ id: string }>;
    /** Retorna o id do registro já existente que a linha corresponde, ou undefined se for novo. */
    encontrarExistenteId?: (data: TSaida) => string | undefined;
    atualizar?: (id: string, data: TSaida) => Promise<{ id: string }>;
    chaveLinha: (row: Record<string, string>) => string;
  },
): Promise<ResultadoImportacao> {
  const criados: string[] = [];
  const atualizados: string[] = [];
  const erros: ErroLinha[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const linha = i + 2; // +2: 1 do header + 1 do índice base-zero
    const chave = opts.chaveLinha(row);

    let input: TInput;
    try {
      input = opts.rowToInput(row);
    } catch (e) {
      erros.push({ linha, chave, erro: e instanceof Error ? e.message : 'Linha inválida' });
      continue;
    }

    const parsed = opts.schema.safeParse(input);
    if (!parsed.success) {
      erros.push({ linha, chave, erro: parsed.error.issues.map((x) => x.message).join('; ') });
      continue;
    }

    const idExistente = opts.encontrarExistenteId?.(parsed.data);

    try {
      if (idExistente && opts.atualizar) {
        await opts.atualizar(idExistente, parsed.data);
        atualizados.push(idExistente);
      } else {
        const criado = await opts.criar(parsed.data);
        criados.push(criado.id);
      }
    } catch (e) {
      erros.push({
        linha,
        chave,
        erro: e instanceof Error ? e.message : idExistente ? 'Erro ao atualizar' : 'Erro ao criar',
      });
    }
  }

  return { criados: criados.length, atualizados: atualizados.length, erros };
}
