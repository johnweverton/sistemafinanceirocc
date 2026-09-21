// Alertas de dado incompleto do pipeline (PRD §5.6). Auditoria 2026-09-02: `itensValidos` já
// separava as linhas sem paciente/sem data, mas `processarMedico` jogava fora os `invalidos` em
// silêncio — o guia do sistema promete "descartadas E reportadas", e só a primeira metade
// acontecia. Sem o alerta, uma origem com linhas quebradas SUBCONTA guias sem deixar rastro.
import { describe, it, expect } from 'vitest';
import type { EntradaProcessamentoMedico, ItemProducao } from '@cobranca/shared';
import { processarMedico } from '../../../src/server/engine/processar-medico';
import { ALERTA_ESPECIALIDADE_AUSENTE } from '../../../src/server/engine/conferencia';

function item(overrides: Partial<ItemProducao> = {}): ItemProducao {
  return {
    data: '2026-07-01',
    pacienteNome: 'Paciente A',
    atendimentoExternoId: null,
    codigoProcedimento: '30715040',
    descricaoProcedimento: 'Visita hospitalar',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
    ...overrides,
  };
}

/** N itens de pacientes DISTINTOS — especialidade não-3x1 conta 1 guia por item. */
function itensValidosDistintos(n: number): ItemProducao[] {
  return Array.from({ length: n }, (_, i) => item({ pacienteNome: `Paciente ${i}` }));
}

function medico(
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
    especialidade: 'Cirurgia Geral',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    semExcedentePorGuia: false,
    ...over,
  };
}

const DESCARTE = /item\(ns\) sem paciente ou data foram descartados/;

describe('processarMedico — itens descartados por falta de paciente/data (auditoria 2026-09-02)', () => {
  it('itens sem data e sem paciente entram no alerta, com a contagem exata de descartes', () => {
    const r = processarMedico({
      medico: medico(),
      itens: [
        ...itensValidosDistintos(6),
        item({ data: '', pacienteNome: 'Sem Data' }),
        item({ pacienteNome: '' }),
        item({ pacienteNome: '   ' }), // só espaços também é descarte (itensValidos usa trim)
      ],
    });

    expect(r.alertas.some((a) => DESCARTE.test(a))).toBe(true);
    expect(r.alertas.some((a) => a.startsWith('3 item(ns) sem paciente ou data'))).toBe(true);
    // Os descartados nunca entram na contagem — só os 6 válidos.
    expect(r.guias).toBe(6);
    expect(r.procedimentos).toBe(6);
    expect(r.status).toBe('alerta');
  });

  it('produção inteiramente íntegra → nenhum alerta de descarte (regressão)', () => {
    const r = processarMedico({ medico: medico(), itens: itensValidosDistintos(6) });

    expect(r.alertas.some((a) => DESCARTE.test(a))).toBe(false);
    expect(r.status).toBe('ok');
  });

  it('TODOS os itens inválidos: continua sem_dados, mas agora diz que foram descartados', () => {
    const r = processarMedico({
      medico: medico(),
      itens: [item({ data: '' }), item({ pacienteNome: '' })],
    });

    expect(r.status).toBe('sem_dados');
    expect(r.alertas).toContain('Nenhum procedimento encontrado para essa competência.');
    expect(r.alertas.some((a) => a.startsWith('2 item(ns) sem paciente ou data'))).toBe(true);
  });

  it('produção retida abaixo do mínimo de guias também reporta os descartes', () => {
    const r = processarMedico({
      medico: medico(),
      itens: [...itensValidosDistintos(2), item({ data: '' })],
    });

    expect(r.status).toBe('acumulado');
    expect(r.alertas.some((a) => a.startsWith('1 item(ns) sem paciente ou data'))).toBe(true);
  });
});

describe('processarMedico — especialidade ausente no cadastro (auditoria 2026-09-02)', () => {
  it('médico sem especialidade COM produção → alerta de cadastro incompleto', () => {
    const r = processarMedico({ medico: medico({ especialidade: null }), itens: itensValidosDistintos(6) });

    expect(r.alertas).toContain(ALERTA_ESPECIALIDADE_AUSENTE);
    expect(r.status).toBe('alerta');
  });

  it('médico sem especialidade e SEM produção → sem_dados, sem o alerta (nada foi contado)', () => {
    const r = processarMedico({ medico: medico({ especialidade: null }), itens: [] });

    expect(r.status).toBe('sem_dados');
    expect(r.alertas).not.toContain(ALERTA_ESPECIALIDADE_AUSENTE);
  });

  it('médico com especialidade cadastrada → sem o alerta (regressão)', () => {
    const r = processarMedico({ medico: medico({ especialidade: 'Pediatra' }), itens: itensValidosDistintos(6) });

    expect(r.alertas).not.toContain(ALERTA_ESPECIALIDADE_AUSENTE);
  });
});
