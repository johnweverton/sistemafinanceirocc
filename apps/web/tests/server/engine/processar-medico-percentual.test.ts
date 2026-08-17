// Casos de ouro do modo percentual da produção (Story 6.2, Épico 6). Função pura, sem I/O.
// GATE do dono (2026-07-08): base = valor COBRADO (charged_val); GLOSADOS ENTRAM na base;
// percentual é configuração por médico (5% é o usual dos auxiliares, não constante).
import { describe, it, expect } from 'vitest';
import type { EntradaProcessamentoMedico, ItemProducao } from '@cobranca/shared';
import { processarMedico } from '../../../src/server/engine/processar-medico';

function item(overrides: Partial<ItemProducao> = {}): ItemProducao {
  return {
    data: '2026-07-01',
    pacienteNome: 'Paciente A',
    atendimentoExternoId: null,
    codigoProcedimento: '31309054',
    descricaoProcedimento: 'Procedimento teste',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 80,
    ...overrides,
  };
}

function medicoPercentual(
  percentual: number | null = 5,
): EntradaProcessamentoMedico['medico'] {
  return {
    id: 'm1',
    cpf: '11122233344',
    nome: 'Dr. Auxiliar',
    statusHapvida: 'nao_credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    especialidade: null,
    modoCobranca: 'percentual_producao',
    percentualProducao: percentual,
    regraPreco: null,
    semExcedentePorGuia: false,
  };
}

describe('processarMedico — modo percentual_producao (Story 6.2)', () => {
  it('caso de ouro: 5% sobre o valor COBRADO, glosados INCLUÍDOS na base', () => {
    const r = processarMedico({
      medico: medicoPercentual(5),
      itens: [
        item({ pacienteNome: 'P1', valorCobradoOrigem: 1000, valorPagoOrigem: 900 }),
        // Glosado ENTRA na base (GATE resposta 2) e o valor PAGO é ignorado (GATE resposta 1).
        item({ pacienteNome: 'P2', statusOrigem: 'Glosado', valorCobradoOrigem: 500, valorPagoOrigem: 0 }),
        item({ pacienteNome: 'P3', statusOrigem: 'Recurso', valorCobradoOrigem: 250.5, valorPagoOrigem: null }),
        // P4/P5: valor 0 (não null) — só pra bater o mínimo de 5 guias (GATE 2026-08-13), sem
        // alterar a base nem disparar o alerta de "item sem valor" (esse exige null, não 0).
        item({ pacienteNome: 'P4', valorCobradoOrigem: 0, valorPagoOrigem: 0 }),
        item({ pacienteNome: 'P5', valorCobradoOrigem: 0, valorPagoOrigem: 0 }),
      ],
    });

    // base = 1000 + 500 + 250.50 = 1750.50 → 5% = 87.525 → arredonda 87.53 (centavos)
    expect(r.totalValor).toBe(87.53);
    expect(r.status).toBe('ok');
    expect(r.subtotais).toHaveLength(1);
    expect(r.subtotais[0]).toMatchObject({
      classe: 'PERCENTUAL_PRODUCAO',
      valor: 87.53,
    });
    // Memória de cálculo exposta para a tela de conferência.
    expect(r.subtotais[0]!.faixa).toContain('5%');
    expect(r.subtotais[0]!.faixa).toContain('1750.50');
  });

  it('contagem de guias e procedimentos continuam rodando (diagnóstico, não preço)', () => {
    const r = processarMedico({
      medico: medicoPercentual(5),
      itens: [
        item({ pacienteNome: 'P1' }),
        item({ pacienteNome: 'P2' }),
      ],
    });
    expect(r.procedimentos).toBe(2);
    expect(r.guias).toBeGreaterThan(0);
  });

  it('item sem valor cobrado na origem → base subcontada vira ALERTA (nunca chuta, PRD §2)', () => {
    const r = processarMedico({
      medico: medicoPercentual(5),
      itens: [
        item({ pacienteNome: 'P1', valorCobradoOrigem: 1000 }),
        item({ pacienteNome: 'P2', valorCobradoOrigem: null }),
        // P3-P5: valor 0 (não null) — só pra bater o mínimo de 5 guias, sem mudar a base nem
        // adicionar outro item "sem valor" (GATE 2026-08-13).
        item({ pacienteNome: 'P3', valorCobradoOrigem: 0 }),
        item({ pacienteNome: 'P4', valorCobradoOrigem: 0 }),
        item({ pacienteNome: 'P5', valorCobradoOrigem: 0 }),
      ],
    });
    expect(r.totalValor).toBe(50); // só a base conhecida
    expect(r.status).toBe('alerta');
    expect(r.alertas.some((a) => a.includes('SUBCONTADA'))).toBe(true);
  });

  it('base zerada (nenhum valor cobrado) → alerta, valor 0', () => {
    const r = processarMedico({
      medico: medicoPercentual(5),
      // 5 itens (mínimo de guias, GATE 2026-08-13), todos sem valor — base continua zerada.
      itens: [
        item({ pacienteNome: 'P1', valorCobradoOrigem: null }),
        item({ pacienteNome: 'P2', valorCobradoOrigem: null }),
        item({ pacienteNome: 'P3', valorCobradoOrigem: null }),
        item({ pacienteNome: 'P4', valorCobradoOrigem: null }),
        item({ pacienteNome: 'P5', valorCobradoOrigem: null }),
      ],
    });
    expect(r.totalValor).toBe(0);
    expect(r.status).toBe('alerta');
    expect(r.alertas.some((a) => a.includes('Base de produção zerada'))).toBe(true);
  });

  it('percentual não configurado (defesa — CHECK do banco impede, engine não confia) → alerta', () => {
    const r = processarMedico({
      medico: medicoPercentual(null),
      // 5 itens (mínimo de guias, GATE 2026-08-13) — percentual 0/null zera o valor de qualquer forma.
      itens: [
        item({ pacienteNome: 'P1', valorCobradoOrigem: 1000 }),
        item({ pacienteNome: 'P2', valorCobradoOrigem: 1000 }),
        item({ pacienteNome: 'P3', valorCobradoOrigem: 1000 }),
        item({ pacienteNome: 'P4', valorCobradoOrigem: 1000 }),
        item({ pacienteNome: 'P5', valorCobradoOrigem: 1000 }),
      ],
    });
    expect(r.totalValor).toBe(0);
    expect(r.status).toBe('alerta');
    expect(r.alertas.some((a) => a.includes('sem percentual configurado'))).toBe(true);
  });

  it('percentual é por médico (não constante): 7.5% calcula 7.5%', () => {
    const r = processarMedico({
      medico: medicoPercentual(7.5),
      itens: [
        item({ pacienteNome: 'P1', valorCobradoOrigem: 2000 }),
        // P2-P5: valor 0 (não null) — só pra bater o mínimo de 5 guias, base continua 2000.
        item({ pacienteNome: 'P2', valorCobradoOrigem: 0 }),
        item({ pacienteNome: 'P3', valorCobradoOrigem: 0 }),
        item({ pacienteNome: 'P4', valorCobradoOrigem: 0 }),
        item({ pacienteNome: 'P5', valorCobradoOrigem: 0 }),
      ],
    });
    expect(r.totalValor).toBe(150);
  });

  it('sem procedimentos válidos → sem_dados (comportamento comum aos dois modos)', () => {
    const r = processarMedico({ medico: medicoPercentual(5), itens: [] });
    expect(r.status).toBe('sem_dados');
  });

  it('REGRESSÃO: médico em faixa_guias produz resultado idêntico ao comportamento original', () => {
    const medicoFaixas: EntradaProcessamentoMedico['medico'] = {
      ...medicoPercentual(null),
      modoCobranca: 'faixa_guias',
      percentualProducao: null,
      statusHapvida: 'credenciado',
    };
    // 5 itens (mínimo de guias, GATE 2026-08-13) — todos ficam na mesma faixa "até 30" de
    // qualquer forma, então o valor esperado (263.59) não muda.
    const itens = [
      item({ pacienteNome: 'P1' }),
      item({ pacienteNome: 'P2' }),
      item({ pacienteNome: 'P3' }),
      item({ pacienteNome: 'P4' }),
      item({ pacienteNome: 'P5' }),
    ];
    const r = processarMedico({ medico: medicoFaixas, itens });

    // Tabela padrão HAPVIDA_CRED: 2 guias → faixa "até 30" = R$ 263.59 (precos.ts).
    expect(r.subtotais).toHaveLength(1);
    expect(r.subtotais[0]).toMatchObject({ classe: 'HAPVIDA_CRED', valor: 263.59 });
    expect(r.totalValor).toBe(263.59);
    // Valores da origem NÃO influenciam o modo faixas (decisão 8 do Épico 5 preservada).
    const rZerado = processarMedico({
      medico: medicoFaixas,
      itens: itens.map((i) => ({ ...i, valorCobradoOrigem: 0.01 })),
    });
    expect(rZerado.totalValor).toBe(263.59);
  });
});
