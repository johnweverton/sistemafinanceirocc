// Funções PURAS de interpretação do que o portal mostra (Story 13.2). Recebem textos já lidos da
// página (o driver em src/portal só coleta) — assim cada regra é testável sem navegador, contra
// os fixtures reais anonimizados em tests/fixtures.

/** Erro de leitura: a tela não tem o formato esperado. Vira captura `erro`, nunca um valor. */
export class ErroExtracao extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroExtracao';
  }
}

export function somenteDigitos(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\D/g, '');
}

function normalizarEspacos(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * '4.330,18' → 4330.18 · '0,00' → 0. Formato estrito pt-BR com 2 casas: qualquer coisa fora
 * disso (vazio, '-', '1,5', '1.2345,00') é `null` — valor malformado nunca vira número.
 */
export function valorBR(texto: string): number | null {
  const t = normalizarEspacos(texto);
  if (!/^-?(\d{1,3}(\.\d{3})*|\d+),\d{2}$/.test(t)) return null;
  return Number(t.replace(/\./g, '').replace(',', '.'));
}

export interface TabelaLida {
  /** Textos das células do `thead` (uma linha de cabeçalho). */
  cabecalho: string[];
  /** Textos das células do `tfoot` (linha "Somatório"). */
  rodape: string[];
}

/**
 * Somatório da tabela "Serviços Prestados" da aba Encerramento (R6). Observado no portal real
 * (gravação 2026-09-21): o Somatório fica no `tfoot`, alinhado 1:1 com o `thead` — por isso a
 * coluna é achada pelo TÍTULO ("Valor do Serviço"), não pela posição, e as linhas A/B/C/D do
 * corpo (que variam por empresa: a C só aparece em algumas) nunca são somadas à mão.
 */
export function extrairSomatorioServicosPrestados(tabela: TabelaLida): { valor: number; quantidade: number } {
  const cab = tabela.cabecalho.map(normalizarEspacos);
  const rod = tabela.rodape.map(normalizarEspacos);

  if (!cab.includes('Serviços Prestados')) {
    throw new ErroExtracao('Tabela lida não é a de "Serviços Prestados"');
  }
  const iValor = cab.indexOf('Valor do Serviço');
  const iQtd = cab.indexOf('Quantidade');
  if (iValor < 0 || iQtd < 0) {
    throw new ErroExtracao('Cabeçalho de "Serviços Prestados" sem "Valor do Serviço"/"Quantidade"');
  }
  if (!rod.includes('Somatório')) {
    throw new ErroExtracao('Rodapé de "Serviços Prestados" sem a linha "Somatório"');
  }
  if (rod.length !== cab.length) {
    throw new ErroExtracao(
      `Rodapé com ${rod.length} colunas e cabeçalho com ${cab.length} — layout mudou, não dá para alinhar`,
    );
  }
  const valor = valorBR(rod[iValor] ?? '');
  const quantidade = /^\d+$/.test(rod[iQtd] ?? '') ? Number(rod[iQtd]) : null;
  if (valor === null || valor < 0) throw new ErroExtracao(`Valor do Somatório ilegível: "${rod[iValor]}"`);
  if (quantidade === null) throw new ErroExtracao(`Quantidade do Somatório ilegível: "${rod[iQtd]}"`);
  return { valor, quantidade };
}

/** Situação da escrituração: 'Fechada - Retificadora(1)' → true · 'Aberta - Normal' → false. */
export function competenciaFechada(situacao: string): boolean | null {
  const t = normalizarEspacos(situacao).toLowerCase();
  if (t.startsWith('fechada')) return true;
  if (t.startsWith('aberta')) return false;
  return null;
}

/**
 * Inscrição municipal comparável. O portal escreve a MESMA inscrição de dois jeitos (gravação
 * real): '0123456-7' na lista de seleção e '123456-7' no cabeçalho "Inscrição Atual".
 */
export function normalizarInscricao(inscricao: string): string {
  return somenteDigitos(inscricao).replace(/^0+/, '');
}

export function mesmaInscricao(a: string, b: string): boolean {
  const na = normalizarInscricao(a);
  return na.length > 0 && na === normalizarInscricao(b);
}

/** 'Inscrição Atual: 123456-7 EMPRESA ALFA LTDA' → { inscricao: '123456-7', razaoSocial: 'EMPRESA ALFA LTDA' }. */
export function lerInscricaoAtual(texto: string): { inscricao: string; razaoSocial: string } | null {
  const m = /Inscri[çc][ãa]o Atual:\s*([\d.\-/]+)\s+(.+)$/i.exec(normalizarEspacos(texto));
  if (!m) return null;
  return { inscricao: m[1]!, razaoSocial: m[2]!.trim() };
}

export interface LinhaEscrituracao {
  competencia: string; // 'MM/AAAA', como o portal mostra
  situacao: string;
  indice: number; // posição na tabela (o N dos ids `manterEscrituracaoForm:dataTable:N:*`)
}

/** Acha a linha da competência alvo ('MM/AAAA') no "Resultado da Consulta". */
export function linhaDaCompetencia(linhas: LinhaEscrituracao[], competenciaPortal: string): LinhaEscrituracao | null {
  return linhas.find((l) => normalizarEspacos(l.competencia) === competenciaPortal) ?? null;
}
