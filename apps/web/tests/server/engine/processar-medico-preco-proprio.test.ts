// Casos de ouro do modo preço próprio (Story 10.1, Épico 10). Função pura, sem I/O.
// GATE do dono (2026-07-20): três formas — por_guia (Dr. Ezequiel, reincluído no automático
// após confirmar R$4,00/guia estável), base+excedente+limiar (Dr. Jansen) e fixo (Nelson,
// Carlos Batista, Jefferson). Nefrologia/guias cardíacas saíram para a Story 10.4 (agrupamento
// por empresa, não override de médico individual).
import { describe, it, expect } from 'vitest';
import type { EntradaProcessamentoMedico, ItemProducao, RegraPreco } from '@cobranca/shared';
import { processarMedico } from '../../../src/server/engine/processar-medico';

function item(overrides: Partial<ItemProducao> = {}): ItemProducao {
  return {
    data: '2026-06-01',
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

function medicoPrecoProprio(
  regraPreco: RegraPreco | null,
): EntradaProcessamentoMedico['medico'] {
  return {
    id: 'm1',
    cpf: '11122233355',
    nome: 'Dr. Jansen',
    statusHapvida: 'nao_credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    especialidade: null,
    modoCobranca: 'preco_proprio',
    percentualProducao: null,
    regraPreco,
    semExcedentePorGuia: false,
  };
}

/** N itens não-pediatra = N guias (1 guia por item, regra "outras especialidades"). */
function itens(n: number): ItemProducao[] {
  return Array.from({ length: n }, (_, i) => item({ pacienteNome: `Paciente ${i}` }));
}

describe('processarMedico — modo preco_proprio, forma por_guia (Story 10.1, Dr. Ezequiel)', () => {
  it('caso de ouro: 90 guias × R$4,00 = R$360,00', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio({ forma: 'por_guia', base: null, limiar: null, taxa: 4.0, valorFixo: null }),
      itens: itens(90),
    });
    expect(r.guias).toBe(90);
    expect(r.totalValor).toBe(360);
    expect(r.status).toBe('ok');
    expect(r.subtotais).toHaveLength(1);
    expect(r.subtotais[0]).toMatchObject({ classe: 'PRECO_PROPRIO', guias: 90, valor: 360 });
  });

  it('linear desde a 1ª guia — sem limiar, diferente de base_excedente', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio({ forma: 'por_guia', base: null, limiar: null, taxa: 4.0, valorFixo: null }),
      itens: itens(1),
    });
    expect(r.totalValor).toBe(4);
  });

  it('regra incompleta (sem taxa) → alerta, valor zerado, nunca chuta (PRD §2)', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio({ forma: 'por_guia', base: null, limiar: null, taxa: null, valorFixo: null }),
      itens: itens(90),
    });
    expect(r.totalValor).toBe(0);
    expect(r.status).toBe('alerta');
    expect(r.alertas.some((a) => a.includes('por guia'))).toBe(true);
    expect(r.subtotais).toHaveLength(0);
  });
});

describe('processarMedico — modo preco_proprio, forma base_excedente (Story 10.1, Dr. Jansen)', () => {
  it('caso de ouro: base 935,62 + (173−144) × 6,50 = 1123,12', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio({ forma: 'base_excedente', base: 935.62, limiar: 144, taxa: 6.5, valorFixo: null }),
      itens: itens(173),
    });

    expect(r.guias).toBe(173);
    expect(r.totalValor).toBeCloseTo(935.62 + (173 - 144) * 6.5, 2);
    expect(r.status).toBe('ok');
    expect(r.subtotais).toHaveLength(1);
    expect(r.subtotais[0]).toMatchObject({ classe: 'PRECO_PROPRIO', guias: 173 });
  });

  it('abaixo do limiar: só a base, sem excedente negativo', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio({ forma: 'base_excedente', base: 935.62, limiar: 144, taxa: 6.5, valorFixo: null }),
      itens: itens(100),
    });
    expect(r.totalValor).toBe(935.62);
  });

  it('regra incompleta (sem taxa) → alerta, valor zerado, nunca chuta (PRD §2)', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio({ forma: 'base_excedente', base: 935.62, limiar: 144, taxa: null, valorFixo: null }),
      itens: itens(173),
    });
    expect(r.totalValor).toBe(0);
    expect(r.status).toBe('alerta');
    expect(r.alertas.some((a) => a.includes('base + excedente'))).toBe(true);
    expect(r.subtotais).toHaveLength(0);
  });
});

describe('processarMedico — modo preco_proprio, forma fixo (Story 10.1, Nelson/Carlos Batista/Jefferson)', () => {
  it('caso de ouro: valor fixo R$591,22 independe da quantidade de guias', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio({ forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 591.22 }),
      itens: itens(37),
    });
    expect(r.guias).toBe(37);
    expect(r.totalValor).toBe(591.22);
    expect(r.status).toBe('ok');
    expect(r.subtotais[0]).toMatchObject({ classe: 'PRECO_PROPRIO', valor: 591.22 });
  });

  it('valor fixo diferente (Jefferson R$130,53) também independe de guias', () => {
    const r1 = processarMedico({
      medico: medicoPrecoProprio({ forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 130.53 }),
      itens: itens(5),
    });
    const r2 = processarMedico({
      medico: medicoPrecoProprio({ forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 130.53 }),
      itens: itens(50),
    });
    expect(r1.totalValor).toBe(130.53);
    expect(r2.totalValor).toBe(130.53);
  });

  it('regra incompleta (sem valorFixo) → alerta, valor zerado', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio({ forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: null }),
      itens: itens(10),
    });
    expect(r.totalValor).toBe(0);
    expect(r.status).toBe('alerta');
    expect(r.alertas.some((a) => a.includes('fixo'))).toBe(true);
  });

  it('modo preco_proprio sem regraPreco (null) → alerta, valor zerado', () => {
    const r = processarMedico({
      medico: medicoPrecoProprio(null),
      itens: itens(10),
    });
    expect(r.totalValor).toBe(0);
    expect(r.status).toBe('alerta');
    expect(r.alertas.some((a) => a.includes('sem regra configurada'))).toBe(true);
  });
});

describe('processarMedico — regressão: médico sem override (Story 10.1)', () => {
  it('modoCobranca faixa_guias com regraPreco presente (ignorado) produz resultado idêntico ao sem regra', () => {
    const medicoBase: EntradaProcessamentoMedico['medico'] = {
      id: 'm2',
      cpf: '99988877766',
      nome: 'Dr. Faixa',
      statusHapvida: 'credenciado',
      fazOutrosHospitais: false,
      fazImobilizacoes: false,
      modoMudancaData: 'nao',
      especialidade: null,
      modoCobranca: 'faixa_guias',
      percentualProducao: null,
      regraPreco: null,
      semExcedentePorGuia: false,
    };
    const comRegraOrfa: EntradaProcessamentoMedico['medico'] = {
      ...medicoBase,
      regraPreco: { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 999 },
    };

    const producao = itens(17);
    const r1 = processarMedico({ medico: medicoBase, itens: producao });
    const r2 = processarMedico({ medico: comRegraOrfa, itens: producao });

    // regraPreco só é lido quando modoCobranca === 'preco_proprio' — presente mas com modo
    // faixa_guias não deve influenciar o cálculo (byte-idêntico).
    expect(r2).toEqual(r1);
    expect(r1.subtotais.every((s) => s.classe !== 'PRECO_PROPRIO')).toBe(true);
  });
});
