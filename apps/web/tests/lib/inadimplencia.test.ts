import { describe, it, expect } from 'vitest';
import { agruparInadimplentesPorMedico, diasEmAtraso } from '../../src/lib/inadimplencia';
import type { Recebivel } from '@cobranca/shared';

function recebivel(overrides: Partial<Recebivel>): Recebivel {
  return {
    boletoId: 'b1',
    execucaoResultadoId: 'e1',
    idExterno: null,
    competencia: '2026-07',
    medicoId: 'm1',
    nome: 'Dr. Fulano',
    valor: 1000,
    vencimento: '2026-07-10',
    pagoEm: null,
    valorPago: null,
    emitidoEm: '2026-07-01T00:00:00Z',
    contaEmissora: 'mc',
    statusDerivado: 'vencido',
    clienteContabilidadeId: null,
    tipoServico: 'cobranca_medica',
    ...overrides,
  };
}

describe('diasEmAtraso', () => {
  it('calcula dias corridos entre o vencimento e hoje', () => {
    expect(diasEmAtraso('2026-07-01', new Date('2026-08-17T00:00:00Z'))).toBe(47);
  });

  it('nunca retorna negativo (vencimento no futuro)', () => {
    expect(diasEmAtraso('2026-09-01', new Date('2026-08-17T00:00:00Z'))).toBe(0);
  });

  it('vencimento hoje → 0 dias', () => {
    expect(diasEmAtraso('2026-08-17', new Date('2026-08-17T00:00:00Z'))).toBe(0);
  });
});

describe('agruparInadimplentesPorMedico', () => {
  const hoje = new Date('2026-08-17T00:00:00Z');

  it('lista vazia → []', () => {
    expect(agruparInadimplentesPorMedico([], hoje)).toEqual([]);
  });

  it('ignora recebíveis que não estão vencidos (defesa em profundidade)', () => {
    const linhas = [
      recebivel({ statusDerivado: 'pago' }),
      recebivel({ statusDerivado: 'em_aberto' }),
      recebivel({ statusDerivado: 'cancelado' }),
    ];
    expect(agruparInadimplentesPorMedico(linhas, hoje)).toEqual([]);
  });

  it('soma valor e conta quantidade de boletos vencidos por médico', () => {
    const linhas = [
      recebivel({ medicoId: 'm1', nome: 'Dr. A', valor: 1000, vencimento: '2026-07-10' }),
      recebivel({ medicoId: 'm1', nome: 'Dr. A', valor: 500, vencimento: '2026-08-01' }),
    ];
    const [a] = agruparInadimplentesPorMedico(linhas, hoje);
    expect(a!.qtdVencidos).toBe(2);
    expect(a!.totalVencido).toBe(1500);
  });

  it('vencimentoMaisAntigo é o mínimo entre os vencidos do médico, independente da ordem de entrada', () => {
    const linhas = [
      recebivel({ medicoId: 'm1', vencimento: '2026-08-01' }),
      recebivel({ medicoId: 'm1', vencimento: '2026-06-15' }),
      recebivel({ medicoId: 'm1', vencimento: '2026-07-20' }),
    ];
    const [a] = agruparInadimplentesPorMedico(linhas, hoje);
    expect(a!.vencimentoMaisAntigo).toBe('2026-06-15');
    expect(a!.diasAtrasoMax).toBe(diasEmAtraso('2026-06-15', hoje));
  });

  it('ordena por totalVencido decrescente — quem deve mais aparece primeiro', () => {
    const linhas = [
      recebivel({ medicoId: 'm1', nome: 'Dr. Pouco', valor: 200 }),
      recebivel({ medicoId: 'm2', nome: 'Dr. Muito', valor: 5000 }),
      recebivel({ medicoId: 'm3', nome: 'Dr. Médio', valor: 1200 }),
    ];
    const resultado = agruparInadimplentesPorMedico(linhas, hoje);
    expect(resultado.map((r) => r.nome)).toEqual(['Dr. Muito', 'Dr. Médio', 'Dr. Pouco']);
  });

  it('medicoId nulo (resultado órfão) usa o nome como chave de agrupamento estável', () => {
    const linhas = [
      recebivel({ medicoId: null, nome: 'Sem Vínculo', valor: 300 }),
      recebivel({ medicoId: null, nome: 'Sem Vínculo', valor: 700 }),
    ];
    const resultado = agruparInadimplentesPorMedico(linhas, hoje);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]!.medicoId).toBeNull();
    expect(resultado[0]!.totalVencido).toBe(1000);
  });

  it('trata valor nulo como 0 na soma (nunca gera NaN)', () => {
    const linhas = [recebivel({ valor: null })];
    const [a] = agruparInadimplentesPorMedico(linhas, hoje);
    expect(a!.totalVencido).toBe(0);
  });
});
