// Motor do relatório DRE (Story 9.2, Épico 9) — função PURA, sem I/O, mesmo padrão de
// conciliacao.ts/categorizacao.ts. Implementa o D4 da arquitetura: lançamento
// RECORRENTE é expandido em instâncias mensais NA LEITURA do relatório (sem cron, sem
// materializar linha nenhuma) — o template só existe como definição; a soma acontece
// aqui, a cada chamada.
//
// Datas são strings YYYY-MM-DD comparadas lexicograficamente (mesma técnica seguraç:
// evita as armadilhas de fuso do JS Date — ver OBS-822 do Épico 8). O grupo da
// categoria (não o tipo CREDIT/DEBIT da transação) decide onde o valor entra na
// fórmula do DRE — transações sem categoria (`categoriaId=null`) NÃO entram no relatório.
import type { ContaEmissora, GrupoPlanoContas, TipoLancamentoManual } from '@cobranca/shared';

export interface TransacaoParaRelatorio {
  contaEmissora: ContaEmissora;
  categoriaId: string | null;
  valor: number;
}

/** Lançamento manual candidato — avulso usa `data`; recorrente usa diaDoMes/dataInicio/dataFim. */
export interface LancamentoParaRelatorio {
  contaEmissora: ContaEmissora;
  categoriaId: string;
  valor: number;
  tipoLancamento: TipoLancamentoManual;
  data: string | null;
  diaDoMes: number | null;
  dataInicio: string | null;
  dataFim: string | null;
}

export interface CategoriaParaRelatorio {
  id: string;
  grupo: GrupoPlanoContas;
}

export interface TotalCategoria {
  categoriaId: string;
  total: number;
}

export interface RelatorioDre {
  porCategoria: TotalCategoria[];
  totalReceitas: number;
  totalDeducoes: number;
  totalDespesasOperacionais: number;
  totalDespesasFinanceiras: number;
  resultadoLiquido: number;
}

function chaveMes(ano: number, mes: number): number {
  return ano * 12 + (mes - 1);
}

function anoMesDaChave(chave: number): { ano: number; mes: number } {
  return { ano: Math.floor(chave / 12), mes: (chave % 12) + 1 };
}

function ocorrenciaDoMes(ano: number, mes: number, diaDoMes: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(diaDoMes).padStart(2, '0')}`;
}

/**
 * Expande um lançamento recorrente em instâncias mensais dentro da interseção
 * `[dataInicio, dataFim ?? periodoFim] ∩ [periodoInicio, periodoFim]` — D4. Uma
 * instância por mês tocado pelo intervalo do relatório; comparação por string de data
 * (não por Date/timezone).
 */
function expandirRecorrente(
  lancamento: LancamentoParaRelatorio & { diaDoMes: number; dataInicio: string },
  periodoInicio: string,
  periodoFim: string,
): number {
  const [anoIni, mesIni] = periodoInicio.split('-').map(Number);
  const [anoFim, mesFim] = periodoFim.split('-').map(Number);
  const [anoTemplate, mesTemplate] = lancamento.dataInicio.split('-').map(Number);

  const primeiroMes = Math.max(chaveMes(anoIni!, mesIni!), chaveMes(anoTemplate!, mesTemplate!));
  const ultimoMes = chaveMes(anoFim!, mesFim!);

  let qtdInstancias = 0;
  for (let m = primeiroMes; m <= ultimoMes; m++) {
    const { ano, mes } = anoMesDaChave(m);
    const ocorrencia = ocorrenciaDoMes(ano, mes, lancamento.diaDoMes);
    if (ocorrencia < periodoInicio || ocorrencia > periodoFim) continue;
    if (ocorrencia < lancamento.dataInicio) continue;
    if (lancamento.dataFim && ocorrencia > lancamento.dataFim) continue;
    qtdInstancias++;
  }
  return qtdInstancias;
}

/** Agrega transações categorizadas + lançamentos manuais em totais por categoria/grupo. */
export function gerarRelatorio(
  transacoes: TransacaoParaRelatorio[],
  lancamentos: LancamentoParaRelatorio[],
  categorias: CategoriaParaRelatorio[],
  periodo: { inicio: string; fim: string },
  conta?: ContaEmissora,
): RelatorioDre {
  const daConta = (c: ContaEmissora) => !conta || c === conta;
  const totaisPorCategoria = new Map<string, number>();
  const soma = (categoriaId: string, valor: number) =>
    totaisPorCategoria.set(categoriaId, (totaisPorCategoria.get(categoriaId) ?? 0) + valor);

  for (const t of transacoes) {
    if (!t.categoriaId || !daConta(t.contaEmissora)) continue;
    soma(t.categoriaId, t.valor);
  }

  for (const l of lancamentos) {
    if (!daConta(l.contaEmissora)) continue;
    if (l.tipoLancamento === 'avulso') {
      if (!l.data || l.data < periodo.inicio || l.data > periodo.fim) continue;
      soma(l.categoriaId, l.valor);
    } else {
      if (!l.diaDoMes || !l.dataInicio) continue;
      const qtd = expandirRecorrente(
        { ...l, diaDoMes: l.diaDoMes, dataInicio: l.dataInicio },
        periodo.inicio,
        periodo.fim,
      );
      if (qtd > 0) soma(l.categoriaId, l.valor * qtd);
    }
  }

  const grupoPorCategoria = new Map(categorias.map((c) => [c.id, c.grupo]));
  let totalReceitas = 0;
  let totalDeducoes = 0;
  let totalDespesasOperacionais = 0;
  let totalDespesasFinanceiras = 0;
  const porCategoria: TotalCategoria[] = [];

  for (const [categoriaId, total] of totaisPorCategoria) {
    porCategoria.push({ categoriaId, total });
    switch (grupoPorCategoria.get(categoriaId)) {
      case 'receita':
        totalReceitas += total;
        break;
      case 'deducao_receita':
        totalDeducoes += total;
        break;
      case 'despesa_operacional':
        totalDespesasOperacionais += total;
        break;
      case 'despesa_financeira':
        totalDespesasFinanceiras += total;
        break;
      default:
        break; // categoria não encontrada (excluída?) — ignora do somatório por grupo
    }
  }

  return {
    porCategoria,
    totalReceitas,
    totalDeducoes,
    totalDespesasOperacionais,
    totalDespesasFinanceiras,
    resultadoLiquido: totalReceitas - totalDeducoes - totalDespesasOperacionais - totalDespesasFinanceiras,
  };
}
