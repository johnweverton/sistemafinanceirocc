// Casos de ouro do acúmulo de guias abaixo do mínimo (achado real 2026-08-13, regra da
// coordenadora financeira): médico com menos de 5 guias combinadas numa competência NÃO gera
// boleto — a produção fica retida (`saldoParaProximaCompetencia`) até somar com um mês futuro e
// bater o limiar. Cobre os 3 modos de cobrança + Angiologista + independência entre buckets
// (principal vs. Outros Hospitais).
import { describe, it, expect } from 'vitest';
import type { EntradaProcessamentoMedico, ItemProducao, SaldoAcumulado } from '@cobranca/shared';
import { processarMedico } from '../../../src/server/engine/processar-medico';

function item(overrides: Partial<ItemProducao> & { pacienteNome: string }): ItemProducao {
  return {
    data: '2026-07-10',
    atendimentoExternoId: null,
    codigoProcedimento: '31309054',
    descricaoProcedimento: 'Procedimento teste',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
    ...overrides,
  };
}

function itensAvulsos(n: number, prefixo: string, over: Partial<ItemProducao> = {}): ItemProducao[] {
  return Array.from({ length: n }, (_, i) => item({ pacienteNome: `${prefixo}-${i}`, ...over }));
}

function medicoBase(
  over: Partial<EntradaProcessamentoMedico['medico']> = {},
): EntradaProcessamentoMedico['medico'] {
  return {
    id: 'm1',
    cpf: '11122233344',
    nome: 'Dr. Teste',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    especialidade: null,
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    semExcedentePorGuia: false,
    ...over,
  };
}

describe('processarMedico — acúmulo abaixo do mínimo de guias (GATE 2026-08-13)', () => {
  it('faixa_guias: 3 guias (julho) → acumulado; +5 novas (agosto) → 8 guias, ok, valor sobre 8', () => {
    const julho = processarMedico({
      medico: medicoBase(),
      itens: itensAvulsos(3, 'P'),
    });
    expect(julho.status).toBe('acumulado');
    expect(julho.totalValor).toBe(0);
    expect(julho.guias).toBe(3);
    expect(julho.subtotais).toEqual([]);
    expect(julho.alertas.some((a) => a.includes('abaixo do mínimo'))).toBe(true);
    expect(julho.saldoParaProximaCompetencia).toEqual({
      guiasPrincipal: 3,
      guiasOutrosHospitais: 0,
      guiasImobilizacoes: 0,
      valorBasePercentual: 0,
    });

    const agosto = processarMedico({
      medico: medicoBase(),
      itens: itensAvulsos(5, 'Q'),
      saldoAcumulado: julho.saldoParaProximaCompetencia,
      saldoAcumuladoDesde: '2026-07',
    });
    expect(agosto.status).toBe('ok');
    expect(agosto.guias).toBe(8);
    // 8 guias ainda cai na faixa "até 30" da tabela padrão (R$263,59) — não é 2 valores somados.
    expect(agosto.totalValor).toBe(263.59);
    expect(agosto.subtotais).toHaveLength(1);
    expect(agosto.subtotais[0]).toMatchObject({ classe: 'HAPVIDA_CRED', guias: 8, valor: 263.59 });
    // Nota informativa de onde vieram as guias vai na memória de cálculo (faixa), não em
    // `alertas` — não é um problema a revisar, então não deve mudar o status pra 'alerta'.
    expect(agosto.subtotais[0]!.faixa).toContain('acumulada');
    expect(agosto.status).toBe('ok');
    expect(agosto.saldoParaProximaCompetencia).toEqual({
      guiasPrincipal: 0,
      guiasOutrosHospitais: 0,
      guiasImobilizacoes: 0,
      valorBasePercentual: 0,
    });
  });

  it('percentual_producao: retém guias E base; soma as duas competências antes de aplicar o percentual', () => {
    const medico = medicoBase({ modoCobranca: 'percentual_producao', percentualProducao: 5 });

    const julho = processarMedico({
      medico,
      itens: itensAvulsos(3, 'P', { valorCobradoOrigem: 100 }), // base = 300
    });
    expect(julho.status).toBe('acumulado');
    expect(julho.saldoParaProximaCompetencia).toMatchObject({ guiasPrincipal: 3, valorBasePercentual: 300 });

    const agosto = processarMedico({
      medico,
      itens: itensAvulsos(5, 'Q', { valorCobradoOrigem: 100 }), // base = 500
      saldoAcumulado: julho.saldoParaProximaCompetencia,
    });
    // base combinada = 300 + 500 = 800 → 5% = 40.00 (NÃO é 15+25=40 calculado por mês separado,
    // mas o resultado bate porque percentual é linear — o que importa é que soma a BASE, não o
    // valor final, pra não quebrar em formas não-lineares como faixa/base+excedente).
    expect(agosto.status).toBe('ok');
    expect(agosto.guias).toBe(8);
    expect(agosto.totalValor).toBe(40);
    expect(agosto.saldoParaProximaCompetencia).toMatchObject({ guiasPrincipal: 0, valorBasePercentual: 0 });
  });

  it('preco_proprio forma fixo: segura o boleto com <5 guias mesmo o valor não dependendo da quantidade', () => {
    const medico = medicoBase({
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 591.22 },
    });

    const julho = processarMedico({ medico, itens: itensAvulsos(2, 'P') });
    expect(julho.status).toBe('acumulado');
    expect(julho.totalValor).toBe(0);

    const agosto = processarMedico({
      medico,
      itens: itensAvulsos(3, 'Q'),
      saldoAcumulado: julho.saldoParaProximaCompetencia,
    });
    // 2+3 = 5 guias bate o mínimo — valor fixo sai integral, não fracionado nem dobrado.
    expect(agosto.status).toBe('ok');
    expect(agosto.guias).toBe(5);
    expect(agosto.totalValor).toBe(591.22);
  });

  it('Angiologista: soma Cateter+Fístula+Angiografia+CartaRede num único bucket de saldo', () => {
    const angio = medicoBase({ especialidade: 'Angiologista' });

    // Todos os 4 lotes vêm DEFINIDOS (mesmo vazios) pra não disparar alerta de "não selecionado"
    // — o foco deste caso é a soma pro limiar, não a interação com esses alertas.
    const julho = processarMedico({
      medico: angio,
      itens: [],
      itensCateter: itensAvulsos(3, 'C'),
      itensFistula: [],
      itensAngiografia: [],
      guiasCartaRede: 0,
    });
    expect(julho.status).toBe('acumulado');
    expect(julho.guias).toBe(3);
    expect(julho.saldoParaProximaCompetencia).toMatchObject({ guiasPrincipal: 3 });

    const agosto = processarMedico({
      medico: angio,
      itens: [],
      itensCateter: [],
      itensFistula: itensAvulsos(5, 'F'),
      itensAngiografia: [],
      guiasCartaRede: 0,
      saldoAcumulado: julho.saldoParaProximaCompetencia,
    });
    expect(agosto.status).toBe('ok');
    expect(agosto.guias).toBe(8);
    expect(agosto.subtotais[0]).toMatchObject({ classe: 'HAPVIDA_CRED', guias: 8, valor: 263.59 });
  });

  it('buckets independentes: saldo de Outros Hospitais não some com o principal, e vice-versa', () => {
    const medico = medicoBase({ fazOutrosHospitais: true });

    // Mês 1: 2 guias principal + 2 Outros Hospitais selecionado (total 4) → acumulado nos dois buckets.
    const mes1 = processarMedico({
      medico,
      itens: itensAvulsos(2, 'P'),
      itensOutrosHospitais: itensAvulsos(2, 'OH'),
      competencia: '2026-07',
    });
    expect(mes1.status).toBe('acumulado');
    expect(mes1.saldoParaProximaCompetencia).toEqual({
      guiasPrincipal: 2,
      guiasOutrosHospitais: 2,
      guiasImobilizacoes: 0,
      valorBasePercentual: 0,
    });

    // Mês 2: +3 principal (total 5, bate o mínimo) mas Outros Hospitais NÃO selecionado nesta
    // execução — o saldo de Outros Hospitais fica INTOCADO (nunca chuta), só o principal é cobrado.
    const mes2 = processarMedico({
      medico,
      itens: itensAvulsos(3, 'Q'),
      itensOutrosHospitais: undefined,
      competencia: '2026-08',
      saldoAcumulado: mes1.saldoParaProximaCompetencia,
    });
    expect(mes2.status).toBe('alerta'); // alerta de "Outros Hospitais não selecionado" continua disparando
    expect(mes2.guias).toBe(5); // só o principal entra no total (Outros Hospitais não ativo)
    expect(mes2.subtotais).toHaveLength(1);
    expect(mes2.subtotais[0]).toMatchObject({ classe: 'HAPVIDA_CRED', guias: 5 });
    // Saldo de Outros Hospitais PRESERVADO (não foi tocado); principal zerado (consumido agora).
    expect(mes2.saldoParaProximaCompetencia).toEqual({
      guiasPrincipal: 0,
      guiasOutrosHospitais: 2,
      guiasImobilizacoes: 0,
      valorBasePercentual: 0,
    });
  });

  it('sem procedimentos novos mas COM saldo retido → continua acumulado (nunca vira sem_dados)', () => {
    const saldo: SaldoAcumulado = {
      guiasPrincipal: 3,
      guiasOutrosHospitais: 0,
      guiasImobilizacoes: 0,
      valorBasePercentual: 0,
    };
    const r = processarMedico({
      medico: medicoBase(),
      itens: [],
      saldoAcumulado: saldo,
    });
    expect(r.status).toBe('acumulado');
    expect(r.guias).toBe(3);
    expect(r.saldoParaProximaCompetencia).toEqual(saldo);
  });

  it('sem procedimentos novos e SEM saldo → sem_dados (comportamento original preservado)', () => {
    const r = processarMedico({ medico: medicoBase(), itens: [] });
    expect(r.status).toBe('sem_dados');
    expect(r.saldoParaProximaCompetencia).toBeUndefined();
  });
});
