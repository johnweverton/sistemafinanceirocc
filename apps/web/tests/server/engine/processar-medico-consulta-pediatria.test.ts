// Casos de ouro do componente de consultas ambulatoriais de pediatria (Story 10.2, Épico 10).
// GATE do dono (2026-07-20, corrigida): consultas vêm de um LOTE SEPARADO na origem (produção
// distinta de fin-producoes), contagem automática via API — não é entrada manual. Valor unitário
// global R$3,00, elegibilidade = todos os médicos marcados como pediatra.
import { describe, it, expect } from 'vitest';
import type { EntradaProcessamentoMedico, ItemProducao } from '@cobranca/shared';
import { processarMedico } from '../../../src/server/engine/processar-medico';

function itemGuia(overrides: Partial<ItemProducao> = {}): ItemProducao {
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

function itemConsulta(overrides: Partial<ItemProducao> = {}): ItemProducao {
  return {
    data: '2026-06-05',
    pacienteNome: 'Paciente Consulta',
    atendimentoExternoId: null,
    codigoProcedimento: '30721033',
    descricaoProcedimento: 'Consulta em consultório',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 150.5,
    valorPagoOrigem: 130,
    ...overrides,
  };
}

function guias(n: number): ItemProducao[] {
  // Não-pediatra seria 1 guia/item; pediatra agrupa por (paciente,data) em teto(n/3).
  // Usamos pacientes distintos para obter exatamente N guias de forma previsível.
  return Array.from({ length: n }, (_, i) => itemGuia({ pacienteNome: `Guia ${i}`, data: `2026-06-${String((i % 27) + 1).padStart(2, '0')}` }));
}

function consultas(n: number): ItemProducao[] {
  return Array.from({ length: n }, (_, i) => itemConsulta({ pacienteNome: `Consulta ${i}` }));
}

function pediatra(overrides: Partial<EntradaProcessamentoMedico['medico']> = {}): EntradaProcessamentoMedico['medico'] {
  return {
    id: 'ped-1',
    cpf: '22233344455',
    nome: 'Dra. Alessandra',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    especialidade: 'Pediatria',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    ...overrides,
  };
}

describe('processarMedico — componente de consultas de pediatria (Story 10.2)', () => {
  it('caso de ouro: 159 consultas × R$3,00 = R$477,00, somado ao valor de guias', () => {
    // 27 guias credenciado (1-30) → R$263,59 (faixa até 30). + 159 consultas × 3 = 477,00.
    const r = processarMedico({
      medico: pediatra(),
      itens: guias(27),
      itensConsultas: consultas(159),
    });

    const consultaSubtotal = r.subtotais.find((s) => s.classe === 'CONSULTA_PEDIATRIA');
    expect(consultaSubtotal).toMatchObject({ guias: 159, valor: 477 });
    expect(r.totalValor).toBeCloseTo(263.59 + 477, 2);
    expect(r.status).toBe('ok');
  });

  it('caso de ouro: 70 consultas × R$3,00 = R$210,00', () => {
    const r = processarMedico({
      medico: pediatra({ id: 'ped-2', nome: 'Dr. Manoel' }),
      itens: guias(10),
      itensConsultas: consultas(70),
    });
    const consultaSubtotal = r.subtotais.find((s) => s.classe === 'CONSULTA_PEDIATRIA');
    expect(consultaSubtotal?.valor).toBe(210);
  });

  it('anti-dupla-contagem: itensConsultas nunca entra na contagem de guias (guias inalterado)', () => {
    const semConsulta = processarMedico({ medico: pediatra(), itens: guias(10) });
    const comConsulta = processarMedico({
      medico: pediatra(),
      itens: guias(10),
      itensConsultas: consultas(50),
    });
    // O componente de guias (contagem e subtotal de faixa) é idêntico com ou sem consultas.
    expect(comConsulta.guias).toBe(semConsulta.guias);
    const faixaSemConsulta = semConsulta.subtotais.find((s) => s.classe !== 'CONSULTA_PEDIATRIA');
    const faixaComConsulta = comConsulta.subtotais.find((s) => s.classe !== 'CONSULTA_PEDIATRIA');
    expect(faixaComConsulta).toEqual(faixaSemConsulta);
  });

  it('pediatra sem consultas (itensConsultas ausente) — valor de guias inalterado, sem subtotal de consulta', () => {
    const r = processarMedico({ medico: pediatra(), itens: guias(10) });
    expect(r.subtotais.some((s) => s.classe === 'CONSULTA_PEDIATRIA')).toBe(false);
  });

  it('pediatra com itensConsultas vazio ([]) — mesmo comportamento de ausente', () => {
    const r = processarMedico({ medico: pediatra(), itens: guias(10), itensConsultas: [] });
    expect(r.subtotais.some((s) => s.classe === 'CONSULTA_PEDIATRIA')).toBe(false);
  });

  it('médico NÃO pediatra com itensConsultas presente — componente ignorado (elegibilidade = só pediatra)', () => {
    const r = processarMedico({
      medico: pediatra({ id: 'nao-ped', especialidade: 'Cardiologia' }),
      itens: guias(10),
      itensConsultas: consultas(50),
    });
    expect(r.subtotais.some((s) => s.classe === 'CONSULTA_PEDIATRIA')).toBe(false);
  });

  it('valor unitário injetável (parâmetro do Engine) — R$5,00 em vez do default R$3,00', () => {
    const r = processarMedico(
      { medico: pediatra(), itens: guias(10), itensConsultas: consultas(10) },
      undefined,
      5.0,
    );
    const consultaSubtotal = r.subtotais.find((s) => s.classe === 'CONSULTA_PEDIATRIA');
    expect(consultaSubtotal?.valor).toBe(50);
  });

  it('pediatra SEM guias hospitalares mas COM consultas — cobra só o componente de consultas (não cai em sem_dados)', () => {
    const r = processarMedico({ medico: pediatra(), itens: [], itensConsultas: consultas(20) });
    expect(r.status).toBe('ok');
    expect(r.totalValor).toBe(60);
    expect(r.guias).toBe(0);
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'CONSULTA_PEDIATRIA', guias: 20, valor: 60 }),
    ]);
  });

  it('médico sem guias e sem consultas continua sem_dados (regressão)', () => {
    const r = processarMedico({ medico: pediatra(), itens: [] });
    expect(r.status).toBe('sem_dados');
    expect(r.totalValor).toBe(0);
  });
});
