// Estado da proposta do ISS por cliente (Story 13.3) — regras R2, R4 e R5 da arquitetura.
import { describe, it, expect } from 'vitest';
import type { CapturaIss } from '@cobranca/shared';
import {
  capturaAceita,
  classificacaoVisualIss,
  clientesAlvoDoIss,
  competenciaDoLinkLote,
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

// Story 13.4 (AC 1, 5) — 3 estados visuais com ação clara, sem jargão do portal no texto visível.
describe('classificacaoVisualIss', () => {
  const semEspacoDuro = (t: string | null) => (t ?? '').replace(/\s/g, ' ');

  it('sem captura → null (nenhum selo, como antes)', () => {
    expect(classificacaoVisualIss(estadoPropostaIss(undefined, undefined))).toBeNull();
  });

  it('preenchível com competência fechada → verde "Veio do ISS", sem motivo', () => {
    const c = classificacaoVisualIss(estadoPropostaIss(captura(), undefined));
    expect(c).toMatchObject({ tom: 'verde', rotulo: 'Veio do ISS', motivo: null });
    // o jargão do portal só aparece no detalhe técnico
    expect(c?.detalheTecnico).toContain('Fechada - Retificadora(1)');
    expect(c?.detalheTecnico).toContain('capturado');
  });

  it('confere com o lançado → verde "Veio do ISS", sem motivo', () => {
    const c = classificacaoVisualIss(estadoPropostaIss(captura(), 34375.07));
    expect(c).toMatchObject({ tom: 'verde', rotulo: 'Veio do ISS', motivo: null });
  });

  it('preenchível com competência aberta (R2) → amarelo "Confira", o valor pode mudar', () => {
    const c = classificacaoVisualIss(estadoPropostaIss(captura({ competenciaFechada: false }), undefined));
    expect(c).toMatchObject({ tom: 'amarelo', rotulo: 'Confira' });
    expect(c?.motivo).toBe('competência ainda aberta no ISS — o valor pode mudar');
  });

  it('alerta (R5) → amarelo "Confira", possível nota fora da escrituração', () => {
    const c = classificacaoVisualIss(
      estadoPropostaIss(captura({ valorServicosPrestados: 0, alertas: ['possivel_nota_fora_escrituracao'] }), undefined),
    );
    expect(c).toMatchObject({ tom: 'amarelo', rotulo: 'Confira' });
    expect(semEspacoDuro(c!.motivo)).toBe('possível nota fora da escrituração (ISS R$ 0,00) — confira antes de digitar');
  });

  it('divergente (R4) → amarelo "Confira", lançado difere do ISS', () => {
    const c = classificacaoVisualIss(estadoPropostaIss(captura({ valorServicosPrestados: 8000 }), 4500));
    expect(c).toMatchObject({ tom: 'amarelo', rotulo: 'Confira' });
    expect(semEspacoDuro(c!.motivo)).toBe('lançado R$ 4.500,00 difere do ISS R$ 8.000,00');
  });

  it.each([
    ['nao_encontrado', 'empresa não encontrada no portal do ISS'],
    ['sem_escrituracao', 'sem escrituração nesta competência (não significa faturamento zero)'],
    ['erro', 'falha na leitura do ISS'],
  ] as const)('indisponível (%s) → cinza "Digite à mão" com o motivo em português', (status, motivo) => {
    const c = classificacaoVisualIss(
      estadoPropostaIss(captura({ status, valorServicosPrestados: null, situacaoIss: null }), undefined),
    );
    expect(c).toMatchObject({ tom: 'cinza', rotulo: 'Digite à mão', motivo });
    expect(c?.detalheTecnico).toContain(`status da captura: ${status}`);
  });

  it('nenhum motivo visível cita a situação bruta, o status ou o horário da captura', () => {
    const estados = [
      estadoPropostaIss(captura(), undefined),
      estadoPropostaIss(captura({ competenciaFechada: false, situacaoIss: 'Aberta' }), undefined),
      estadoPropostaIss(captura({ valorServicosPrestados: 8000 }), 4500),
      estadoPropostaIss(captura({ status: 'erro', valorServicosPrestados: null, mensagemErro: 'Timeout 30000ms' }), undefined),
    ];
    for (const e of estados) {
      const c = classificacaoVisualIss(e)!;
      const visivel = `${c.rotulo} ${c.motivo ?? ''}`;
      expect(visivel).not.toMatch(/Retificadora|Fechada|Aberta|capturado|nao_encontrado|Timeout|2026-09-21|21\/09/);
    }
  });
});

describe('competenciaDoLinkLote (Story 13.4, AC 12)', () => {
  it('aceita AAAA-MM válido', () => {
    expect(competenciaDoLinkLote('2026-08')).toBe('2026-08');
  });

  it.each([null, undefined, '', '2026-13', '2026-8', 'agosto', '2026-08-01'])('rejeita %s', (v) => {
    expect(competenciaDoLinkLote(v)).toBeNull();
  });
});

describe('clientesAlvoDoIss (Story 13.4, AC 12)', () => {
  it('mesmo critério de listarAlvosIss: ativos em faixa_faturamento', () => {
    const lista = [
      { id: 'a', ativo: true, modoCobranca: 'faixa_faturamento' },
      { id: 'b', ativo: false, modoCobranca: 'faixa_faturamento' },
      { id: 'c', ativo: true, modoCobranca: 'fixo' },
    ];
    expect(clientesAlvoDoIss(lista).map((c) => c.id)).toEqual(['a']);
  });
});
