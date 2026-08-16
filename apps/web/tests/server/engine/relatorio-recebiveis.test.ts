// Testes do agrupamento de recebíveis por empresa (Módulo de Relatórios).
import { describe, it, expect } from 'vitest';
import { agruparRecebiveisPorEmpresa } from '@/server/engine/relatorio-recebiveis';
import type { Recebivel } from '@cobranca/shared';

function recebivel(overrides: Partial<Recebivel> = {}): Recebivel {
  return {
    boletoId: 'b1',
    execucaoResultadoId: 'er1',
    idExterno: 'ext1',
    competencia: '2026-06',
    medicoId: 'm1',
    nome: 'Dr. A',
    valor: 1000,
    vencimento: '2026-06-10',
    pagoEm: null,
    valorPago: null,
    emitidoEm: '2026-06-01T00:00:00Z',
    contaEmissora: 'mc',
    statusDerivado: 'em_aberto',
    ...overrides,
  };
}

describe('agruparRecebiveisPorEmpresa', () => {
  it('lista vazia produz relatório sem grupos e total geral zerado', () => {
    const relatorio = agruparRecebiveisPorEmpresa([], {});
    expect(relatorio.grupos).toHaveLength(0);
    expect(relatorio.totalGeral).toMatchObject({ qtd: 0, totalEmitido: 0 });
  });

  it('agrupa por contaEmissora e calcula subtotal por grupo', () => {
    const recebiveis = [
      recebivel({ boletoId: 'b1', contaEmissora: 'mc', valor: 1000, statusDerivado: 'em_aberto' }),
      recebivel({ boletoId: 'b2', contaEmissora: 'mc', valor: 500, statusDerivado: 'pago', valorPago: 500, pagoEm: '2026-06-15' }),
      recebivel({ boletoId: 'b3', contaEmissora: 'cc_solucoes', valor: 300, statusDerivado: 'vencido' }),
    ];
    const relatorio = agruparRecebiveisPorEmpresa(recebiveis, { competencia: '2026-06' });

    expect(relatorio.grupos).toHaveLength(2);
    const mc = relatorio.grupos.find((g) => g.contaEmissora === 'mc')!;
    expect(mc.subtotal).toMatchObject({ qtd: 2, totalEmitido: 1500, totalPago: 500, totalEmAberto: 1000 });

    const cc = relatorio.grupos.find((g) => g.contaEmissora === 'cc_solucoes')!;
    expect(cc.subtotal).toMatchObject({ qtd: 1, totalEmitido: 300, totalVencido: 300 });
  });

  it('total geral soma todos os grupos', () => {
    const recebiveis = [
      recebivel({ boletoId: 'b1', contaEmissora: 'mc', valor: 1000 }),
      recebivel({ boletoId: 'b2', contaEmissora: 'cc_solucoes', valor: 300, statusDerivado: 'vencido' }),
    ];
    const relatorio = agruparRecebiveisPorEmpresa(recebiveis, {});
    expect(relatorio.totalGeral).toMatchObject({ qtd: 2, totalEmitido: 1300 });
  });

  it('subtotal exclui cancelado do totalEmitido, mas rastreia em totalCancelado (regra 0043)', () => {
    const recebiveis = [
      recebivel({ boletoId: 'b1', contaEmissora: 'mc', valor: 1000, statusDerivado: 'pago', valorPago: 1000 }),
      recebivel({ boletoId: 'b2', contaEmissora: 'mc', valor: 400, statusDerivado: 'cancelado' }),
    ];
    const relatorio = agruparRecebiveisPorEmpresa(recebiveis, {});
    const mc = relatorio.grupos[0]!;
    expect(mc.subtotal.totalEmitido).toBe(1000); // não inclui os 400 cancelados
    expect(mc.subtotal.totalCancelado).toBe(400);
    expect(relatorio.totalGeral.totalEmitido).toBe(1000);
  });

  it('preserva o filtro recebido no resultado', () => {
    const relatorio = agruparRecebiveisPorEmpresa([], { competencia: '2026-07', contaEmissora: 'mc' });
    expect(relatorio.filtro).toEqual({ competencia: '2026-07', contaEmissora: 'mc' });
  });
});
