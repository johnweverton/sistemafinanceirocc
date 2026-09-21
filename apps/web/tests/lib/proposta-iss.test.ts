// Estado da proposta do ISS por cliente (Story 13.3) — regras R2, R4 e R5 da arquitetura.
import { describe, it, expect } from 'vitest';
import type { CapturaIss } from '@cobranca/shared';
import {
  capturaAceita,
  estadoPropostaIss,
  mesmoValor,
  valorInicialDoCampo,
} from '../../src/lib/proposta-iss';

function captura(over: Partial<CapturaIss> = {}): CapturaIss {
  return {
    id: 'cap-1',
    execucaoId: 'exec-1',
    clienteContabilidadeId: 'cc-1',
    competencia: '2026-08',
    status: 'capturado',
    valorServicosPrestados: 34375.07,
    quantidadeNotas: 12,
    situacaoIss: 'Fechada - Retificadora(1)',
    competenciaFechada: true,
    inscricaoMunicipal: '196992-7',
    razaoSocialIss: 'EMPRESA X',
    alertas: [],
    mensagemErro: null,
    capturadoEm: '2026-09-21T13:40:00Z',
    ...over,
  };
}

describe('estadoPropostaIss', () => {
  it('sem captura → sem_captura, campo vazio', () => {
    const e = estadoPropostaIss(undefined, undefined);
    expect(e.tipo).toBe('sem_captura');
    expect(valorInicialDoCampo(e)).toBe('');
  });

  it.each(['nao_encontrado', 'sem_escrituracao', 'erro'] as const)(
    'status %s → indisponível, campo vazio (sem escrituração NÃO é faturamento zero)',
    (status) => {
      const e = estadoPropostaIss(captura({ status, valorServicosPrestados: null }), undefined);
      expect(e.tipo).toBe('indisponivel');
      expect(valorInicialDoCampo(e)).toBe('');
    },
  );

  it('capturado e nada lançado → preenchível, com o valor da proposta', () => {
    const e = estadoPropostaIss(captura(), undefined);
    expect(e).toMatchObject({ tipo: 'preenchivel', valor: 34375.07, aberta: false });
    expect(valorInicialDoCampo(e)).toBe('34375.07');
  });

  it('R2: competência aberta pré-preenche mas sinaliza `aberta`', () => {
    const e = estadoPropostaIss(captura({ competenciaFechada: false }), undefined);
    expect(e).toMatchObject({ tipo: 'preenchivel', aberta: true });
    expect(valorInicialDoCampo(e)).toBe('34375.07');
  });

  it('R4: lançamento com valor diferente → divergente, NÃO pré-preenche', () => {
    const e = estadoPropostaIss(captura(), 30000);
    expect(e).toMatchObject({ tipo: 'divergente', valor: 34375.07, lancado: 30000 });
    expect(valorInicialDoCampo(e)).toBe('');
  });

  it('R4: lançamento igual à proposta → confere (comparação em centavos)', () => {
    expect(estadoPropostaIss(captura({ valorServicosPrestados: 0.3 }), 0.1 + 0.2).tipo).toBe('confere');
  });

  it('R5: captura com alerta → NÃO pré-preenche, o operador decide', () => {
    const e = estadoPropostaIss(
      captura({ valorServicosPrestados: 0, alertas: ['possivel_nota_fora_escrituracao'] }),
      undefined,
    );
    expect(e.tipo).toBe('alerta');
    expect(valorInicialDoCampo(e)).toBe('');
  });

  it('valor 0 sem alerta é um valor legítimo e pré-preenche "0"', () => {
    const e = estadoPropostaIss(captura({ valorServicosPrestados: 0 }), undefined);
    expect(e.tipo).toBe('preenchivel');
    expect(valorInicialDoCampo(e)).toBe('0');
  });
});

describe('capturaAceita', () => {
  it('cita a captura só quando o valor final é exatamente o da proposta', () => {
    const e = estadoPropostaIss(captura(), undefined);
    expect(capturaAceita(e, 34375.07)).toBe('cap-1');
    expect(capturaAceita(e, 34375.08)).toBeUndefined();
  });

  it('nunca cita captura quando não havia valor da proposta', () => {
    expect(capturaAceita(estadoPropostaIss(undefined, undefined), 100)).toBeUndefined();
    expect(
      capturaAceita(estadoPropostaIss(captura({ status: 'erro', valorServicosPrestados: null }), undefined), 100),
    ).toBeUndefined();
  });
});

describe('mesmoValor', () => {
  it('ignora ruído de ponto flutuante', () => {
    expect(mesmoValor(0.1 + 0.2, 0.3)).toBe(true);
    expect(mesmoValor(10, 10.01)).toBe(false);
  });
});
