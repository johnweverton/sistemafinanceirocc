// Agrupamento de recebíveis por empresa (conta emissora) — Módulo de Relatórios. Função pura,
// sem I/O, mesmo padrão dos outros módulos do engine (ex.: ofx.ts). Reusa o mesmo Recebivel já
// consumido em /recebiveis (vw_recebiveis via recebiveis-repository.ts) — nenhuma regra de
// status nova, só reagrupamento + soma.
import type { Recebivel, RelatorioRecebiveis, GrupoRelatorioRecebiveis, SubtotalRelatorio, ContaEmissora, TipoServico } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';

function subtotalVazio(): SubtotalRelatorio {
  return { qtd: 0, totalEmitido: 0, totalPago: 0, totalEmAberto: 0, totalVencido: 0, totalCancelado: 0 };
}

/**
 * Acumula uma linha no subtotal. `totalEmitido` exclui cancelado (mesma regra da migration
 * 0043 — um boleto cancelado não é receita emitida); `totalCancelado` é rastreado à parte.
 */
function acumular(subtotal: SubtotalRelatorio, r: Recebivel): SubtotalRelatorio {
  const valor = r.valor ?? 0;
  return {
    qtd: subtotal.qtd + 1,
    totalEmitido: subtotal.totalEmitido + (r.statusDerivado === 'cancelado' ? 0 : valor),
    totalPago: subtotal.totalPago + (r.statusDerivado === 'pago' ? (r.valorPago ?? valor) : 0),
    totalEmAberto: subtotal.totalEmAberto + (r.statusDerivado === 'em_aberto' ? valor : 0),
    totalVencido: subtotal.totalVencido + (r.statusDerivado === 'vencido' ? valor : 0),
    totalCancelado: subtotal.totalCancelado + (r.statusDerivado === 'cancelado' ? valor : 0),
  };
}

function somarSubtotais(a: SubtotalRelatorio, b: SubtotalRelatorio): SubtotalRelatorio {
  return {
    qtd: a.qtd + b.qtd,
    totalEmitido: a.totalEmitido + b.totalEmitido,
    totalPago: a.totalPago + b.totalPago,
    totalEmAberto: a.totalEmAberto + b.totalEmAberto,
    totalVencido: a.totalVencido + b.totalVencido,
    totalCancelado: a.totalCancelado + b.totalCancelado,
  };
}

export function agruparRecebiveisPorEmpresa(
  recebiveis: Recebivel[],
  filtro: { competencia?: string; contaEmissora?: ContaEmissora; tipoServico?: TipoServico },
): RelatorioRecebiveis {
  const porEmpresa = new Map<ContaEmissora, Recebivel[]>();
  for (const r of recebiveis) {
    const lista = porEmpresa.get(r.contaEmissora) ?? [];
    lista.push(r);
    porEmpresa.set(r.contaEmissora, lista);
  }

  const grupos: GrupoRelatorioRecebiveis[] = Array.from(porEmpresa.entries())
    .sort(([a], [b]) => CONTA_EMISSORA_LABEL[a].localeCompare(CONTA_EMISSORA_LABEL[b]))
    .map(([contaEmissora, linhas]) => ({
      contaEmissora,
      contaEmissoraLabel: CONTA_EMISSORA_LABEL[contaEmissora],
      linhas,
      subtotal: linhas.reduce(acumular, subtotalVazio()),
    }));

  const totalGeral = grupos.reduce((acc, g) => somarSubtotais(acc, g.subtotal), subtotalVazio());

  return {
    filtro,
    geradoEm: new Date().toISOString(),
    grupos,
    totalGeral,
  };
}
