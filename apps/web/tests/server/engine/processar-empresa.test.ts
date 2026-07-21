// Casos de ouro do cálculo agregado por empresa (Story 10.4b, Épico 10). Função pura, sem I/O.
// MVP: só a forma 'por_guia' é suportada — base_excedente/fixo geram alerta (AC 3, GATE do @po).
import { describe, it, expect } from 'vitest';
import type { ItemProducao, RegraPreco } from '@cobranca/shared';
import { processarEmpresa } from '../../../src/server/engine/processar-empresa';

function itens(n: number, prefixo: string): ItemProducao[] {
  return Array.from({ length: n }, (_, i) => ({
    data: '2026-06-01',
    pacienteNome: `${prefixo}-${i}`,
    atendimentoExternoId: null,
    codigoProcedimento: '30715040',
    descricaoProcedimento: 'Guia cardíaca',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
  }));
}

const REGRA_MEDISA: RegraPreco = { forma: 'por_guia', base: null, limiar: null, taxa: 6.41, valorFixo: null };

describe('processarEmpresa — caso de ouro MEDISA (Story 10.4b)', () => {
  it('3 médicos somando 461 guias × R$6,41 = R$2.955,01 (evidência da conferência 2026-07-14)', () => {
    const resultado = processarEmpresa({
      regraPreco: REGRA_MEDISA,
      medicos: [
        { medicoId: 'm1', itens: itens(150, 'm1') },
        { medicoId: 'm2', itens: itens(150, 'm2') },
        { medicoId: 'm3', itens: itens(161, 'm3') },
      ],
    });

    expect(resultado.guias).toBe(461);
    expect(resultado.totalValor).toBeCloseTo(2955.01, 2);
    expect(resultado.status).toBe('ok');
    expect(resultado.alertas).toEqual([]);
  });

  it('soma das contribuições por médico == valor total (sem perda de arredondamento)', () => {
    const resultado = processarEmpresa({
      regraPreco: REGRA_MEDISA,
      medicos: [
        { medicoId: 'm1', itens: itens(150, 'm1') },
        { medicoId: 'm2', itens: itens(150, 'm2') },
        { medicoId: 'm3', itens: itens(161, 'm3') },
      ],
    });

    const somaContribuicoes = resultado.contribuicoes.reduce((acc, c) => acc + c.valor, 0);
    expect(somaContribuicoes).toBeCloseTo(resultado.totalValor, 2);
    expect(resultado.contribuicoes).toHaveLength(3);
    expect(resultado.contribuicoes.find((c) => c.medicoId === 'm3')).toMatchObject({ guias: 161 });
  });

  it('contribuição de cada médico é guias_medico × taxa (distributiva)', () => {
    const resultado = processarEmpresa({
      regraPreco: REGRA_MEDISA,
      medicos: [
        { medicoId: 'm1', itens: itens(100, 'm1') },
        { medicoId: 'm2', itens: itens(50, 'm2') },
      ],
    });
    expect(resultado.contribuicoes.find((c) => c.medicoId === 'm1')?.valor).toBeCloseTo(100 * 6.41, 2);
    expect(resultado.contribuicoes.find((c) => c.medicoId === 'm2')?.valor).toBeCloseTo(50 * 6.41, 2);
  });
});

describe('processarEmpresa — alertas (nunca chuta, PRD §2)', () => {
  it('regra ausente → alerta, valor 0, sem contribuições', () => {
    const resultado = processarEmpresa({ regraPreco: null, medicos: [{ medicoId: 'm1', itens: itens(50, 'm1') }] });
    expect(resultado.status).toBe('alerta');
    expect(resultado.totalValor).toBe(0);
    expect(resultado.contribuicoes).toEqual([]);
  });

  it('regra por_guia sem taxa → alerta', () => {
    const regra: RegraPreco = { forma: 'por_guia', base: null, limiar: null, taxa: null, valorFixo: null };
    const resultado = processarEmpresa({ regraPreco: regra, medicos: [{ medicoId: 'm1', itens: itens(50, 'm1') }] });
    expect(resultado.status).toBe('alerta');
  });

  it('forma base_excedente na empresa → alerta explícito, NUNCA um rateio chutado (AC 3, MVP)', () => {
    const regra: RegraPreco = { forma: 'base_excedente', base: 1000, limiar: 100, taxa: 5, valorFixo: null };
    const resultado = processarEmpresa({
      regraPreco: regra,
      medicos: [{ medicoId: 'm1', itens: itens(150, 'm1') }],
    });
    expect(resultado.status).toBe('alerta');
    expect(resultado.totalValor).toBe(0);
    expect(resultado.contribuicoes).toEqual([]);
    expect(resultado.alertas[0]).toContain('base_excedente');
  });

  it('forma fixo na empresa → alerta explícito, NUNCA um rateio chutado (AC 3, MVP)', () => {
    const regra: RegraPreco = { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: 5000 };
    const resultado = processarEmpresa({
      regraPreco: regra,
      medicos: [{ medicoId: 'm1', itens: itens(150, 'm1') }],
    });
    expect(resultado.status).toBe('alerta');
    expect(resultado.alertas[0]).toContain('fixo');
  });
});

describe('processarEmpresa — regressão de contagem', () => {
  it('reaproveita contarGuiasProducao sem mudança (não-pediatra = 1 guia por item)', () => {
    const resultado = processarEmpresa({
      regraPreco: REGRA_MEDISA,
      medicos: [{ medicoId: 'm1', itens: itens(37, 'm1'), especialidade: 'Cardiologia' }],
    });
    expect(resultado.guias).toBe(37);
  });
});
