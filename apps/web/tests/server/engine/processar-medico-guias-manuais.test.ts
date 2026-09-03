// Contagem de guias conferida MANUALMENTE por planilha (migration 0058, aprovado 2026-09-03).
// Função ALTERNATIVA à contagem automática: quando `guiasManuaisTotal` vem preenchido, o motor
// pula `contarGuiasProducao`/`consolidarProducao` DAQUELE médico e usa o número informado — o
// resto do pipeline (consultas de pediatria, saldo acumulado, limiar mínimo, tabela de preço)
// continua exatamente igual. Aberto a qualquer especialidade.
import { describe, it, expect } from 'vitest';
import type { EntradaProcessamentoMedico, ItemProducao } from '@cobranca/shared';
import { processarMedico } from '../../../src/server/engine/processar-medico';

function item(overrides: Partial<ItemProducao> = {}): ItemProducao {
  return {
    data: '2026-06-01',
    pacienteNome: 'Paciente Guia',
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

/** N itens de pacientes distintos — para um médico 3x1 (pediatra) dá teto(1/3)=1 guia por item. */
function itensGuias(n: number): ItemProducao[] {
  return Array.from({ length: n }, (_, i) =>
    item({ pacienteNome: `Guia ${i}`, data: `2026-06-${String((i % 27) + 1).padStart(2, '0')}` }),
  );
}

function itensConsultas(n: number): ItemProducao[] {
  return Array.from({ length: n }, (_, i) =>
    item({
      pacienteNome: `Consulta ${i}`,
      data: '2026-06-05',
      codigoProcedimento: '30721033',
      descricaoProcedimento: 'Consulta em consultório',
    }),
  );
}

function medico(
  overrides: Partial<EntradaProcessamentoMedico['medico']> = {},
): EntradaProcessamentoMedico['medico'] {
  return {
    id: 'med-1',
    cpf: '11144477735',
    nome: 'Dr. Fulano',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    especialidade: 'Urologia',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    semExcedentePorGuia: false,
    ...overrides,
  };
}

const MOTIVO = 'Conferencia manual do dono — contagem automatica divergiu';

describe('processarMedico — contagem manual por planilha (migration 0058)', () => {
  it('usa o total informado como guias, ignorando a contagem automática da produção', () => {
    // 10 itens de pacientes distintos → a contagem automática daria 10 guias.
    const automatico = processarMedico({ medico: medico(), itens: itensGuias(10) });
    expect(automatico.guias).toBe(10);

    const manual = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      guiasManuaisTotal: 42,
      guiasManuaisMotivo: MOTIVO,
    });

    expect(manual.guias).toBe(42);
    expect(manual.guiasConsolidado).toBe(42);
    // Total agregado digitado não diz quantas eram cirurgia — nunca chuta.
    expect(manual.cirurgias).toBe(0);
  });

  it('a tabela de preço é aplicada sobre o número manual (42 guias credenciado → faixa até 50)', () => {
    const r = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      guiasManuaisTotal: 42,
      guiasManuaisMotivo: MOTIVO,
    });

    expect(r.subtotais).toHaveLength(1);
    expect(r.subtotais[0]).toMatchObject({ classe: 'HAPVIDA_CRED', guias: 42, valor: 394.12 });
    expect(r.totalValor).toBe(394.12);
  });

  it('registra o alerta de auditoria com o total e o motivo, na PRIMEIRA posição', () => {
    const r = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      guiasManuaisTotal: 42,
      guiasManuaisMotivo: MOTIVO,
    });

    expect(r.alertas[0]).toBe(
      `CONTAGEM MANUAL (planilha): 42 guia(s) informada(s) manualmente. Motivo: ${MOTIVO}`,
    );
    // Auditoria vive SÓ no array de alertas (relatório interno) — nenhum campo novo no resultado.
    expect(Object.keys(r)).not.toContain('contagemManual');
  });

  it('consultas ambulatoriais do pediatra continuam contadas normalmente (fonte de dado diferente)', () => {
    const r = processarMedico(
      {
        medico: medico({ especialidade: 'Pediatria' }),
        itens: itensGuias(10),
        itensConsultas: itensConsultas(70),
        guiasManuaisTotal: 12,
        guiasManuaisMotivo: MOTIVO,
      },
      undefined,
      3,
    );

    expect(r.guias).toBe(12);
    expect(r.subtotais.find((s) => s.classe === 'CONSULTA_PEDIATRIA')).toMatchObject({
      guias: 70,
      valor: 210,
    });
    // R$263,59 (12 guias credenciado, faixa até 30) + R$210,00 de consultas.
    expect(r.totalValor).toBeCloseTo(263.59 + 210, 2);
  });

  it('limiar mínimo de 5 guias continua valendo sobre o número manual (3 guias → acumula)', () => {
    const r = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      guiasManuaisTotal: 3,
      guiasManuaisMotivo: MOTIVO,
    });

    expect(r.status).toBe('acumulado');
    expect(r.totalValor).toBe(0);
    expect(r.saldoParaProximaCompetencia).toMatchObject({ guiasPrincipal: 3 });
    // A marca de contagem manual acompanha o resultado mesmo no caminho de acúmulo.
    expect(r.alertas[0]).toContain('CONTAGEM MANUAL');
  });

  it('saldo acumulado de competências anteriores soma ao número manual', () => {
    const r = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      guiasManuaisTotal: 3,
      guiasManuaisMotivo: MOTIVO,
      saldoAcumulado: { guiasPrincipal: 4, guiasOutrosHospitais: 0, guiasImobilizacoes: 0, valorBasePercentual: 0 },
      saldoAcumuladoDesde: '2026-05',
    });

    // 3 (manual) + 4 (saldo) = 7 → bate o limiar e cobra a faixa até 30.
    expect(r.guias).toBe(7);
    expect(r.status).toBe('ok');
    expect(r.totalValor).toBe(263.59);
    expect(r.subtotais[0]?.faixa).toContain('inclui 4 guia(s) acumulada(s) desde 2026-05');
    expect(r.saldoParaProximaCompetencia).toMatchObject({ guiasPrincipal: 0 });
  });

  it('total manual sem produção válida na origem NÃO cai em sem_dados (o número conferido vale)', () => {
    const r = processarMedico({
      medico: medico(),
      itens: [],
      guiasManuaisTotal: 20,
      guiasManuaisMotivo: MOTIVO,
    });

    expect(r.status).not.toBe('sem_dados');
    expect(r.guias).toBe(20);
    expect(r.totalValor).toBe(263.59);
  });

  it('total manual 0 é um número informado (não é "ausente") — retém em vez de cobrar', () => {
    const r = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      guiasManuaisTotal: 0,
      guiasManuaisMotivo: MOTIVO,
    });

    expect(r.guias).toBe(0);
    expect(r.status).toBe('acumulado');
    expect(r.alertas[0]).toContain('CONTAGEM MANUAL (planilha): 0 guia(s)');
  });

  it('preserva o alerta de VARIAÇÃO ALTA contra o mês anterior (sanidade do número digitado)', () => {
    const r = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      historicoGuias: 10,
      guiasManuaisTotal: 100,
      guiasManuaisMotivo: MOTIVO,
    });

    expect(r.alertas.some((a) => a.includes('VARIAÇÃO'))).toBe(true);
  });

  // GATE do dono (2026-09-03): a marca de contagem manual é AUDITORIA, não pendência de
  // conferência. Se derrubasse o status, cada médico da planilha teria que passar pelo "Revisar e
  // liberar" antes de emitir (`validarResultadoParaEmissao` só aceita 'ok') — atrito puro sobre um
  // número que já nasceu conferido à mão.
  it('a marca de contagem manual sozinha NÃO derruba o status: sai como ok, pronto pra emitir', () => {
    const r = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      guiasManuaisTotal: 42,
      guiasManuaisMotivo: MOTIVO,
    });

    expect(r.status).toBe('ok');
    // ...mas o rastro continua no relatório interno.
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0]).toContain('CONTAGEM MANUAL');
  });

  it('QUALQUER outro alerta junto continua derrubando o status (a conferência não é enfraquecida)', () => {
    // Variação alta: 10 guias no mês anterior contra 100 informadas agora.
    const variacao = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      historicoGuias: 10,
      guiasManuaisTotal: 100,
      guiasManuaisMotivo: MOTIVO,
    });
    expect(variacao.status).toBe('alerta');

    // Dado incompleto na origem (item sem código) — vem de `checar`, que segue rodando.
    const incompleto = processarMedico({
      medico: medico(),
      itens: [...itensGuias(9), item({ pacienteNome: 'Sem codigo', codigoProcedimento: '' })],
      guiasManuaisTotal: 42,
      guiasManuaisMotivo: MOTIVO,
    });
    expect(incompleto.status).toBe('alerta');
    expect(incompleto.alertas[0]).toContain('CONTAGEM MANUAL');
    expect(incompleto.alertas.some((a) => a.includes('sem código ou descrição'))).toBe(true);
  });

  it('sem contagem manual, um alerta qualquer continua derrubando o status (regressão)', () => {
    const r = processarMedico({
      medico: medico(),
      itens: [...itensGuias(9), item({ pacienteNome: 'Sem codigo', codigoProcedimento: '' })],
    });
    expect(r.status).toBe('alerta');
  });

  it('não dispara MODO INCONSISTENTE por conta da produção não usada', () => {
    // Itens em modo "sim" (1 procedimento por dia, mesmo atendimento) com cadastro em "nao":
    // no fluxo automático isso geraria MODO INCONSISTENTE. Com contagem manual não há
    // agrupamento automático a conferir — o alerta seria ruído sobre um número que não veio dali.
    const itensModoSim = Array.from({ length: 6 }, (_, i) =>
      item({ atendimentoExternoId: 'ATEND-1', pacienteNome: 'Paciente X', data: `2026-06-0${i + 1}` }),
    );
    const automatico = processarMedico({ medico: medico({ especialidade: 'Pediatria' }), itens: itensModoSim });
    expect(automatico.alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(true);

    const manual = processarMedico({
      medico: medico({ especialidade: 'Pediatria' }),
      itens: itensModoSim,
      guiasManuaisTotal: 6,
      guiasManuaisMotivo: MOTIVO,
    });
    expect(manual.alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(false);
  });

  it('sem guiasManuaisTotal, nada muda (regressão do fluxo automático)', () => {
    const semCampo = processarMedico({ medico: medico(), itens: itensGuias(10) });
    const comNull = processarMedico({
      medico: medico(),
      itens: itensGuias(10),
      guiasManuaisTotal: null,
      guiasManuaisMotivo: null,
    });
    expect(comNull).toEqual(semCampo);
  });

  it('vale para qualquer especialidade — não trava em urologia/ginecologia/pediatria', () => {
    for (const especialidade of ['Cardiologia', 'Ortopedia', 'Ginecologia', null]) {
      const r = processarMedico({
        medico: medico({ especialidade }),
        itens: itensGuias(10),
        guiasManuaisTotal: 42,
        guiasManuaisMotivo: MOTIVO,
      });
      expect(r.guias).toBe(42);
      expect(r.totalValor).toBe(394.12);
    }
  });
});
