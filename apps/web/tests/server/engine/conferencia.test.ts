// Trava de conferência (PRD §5.3, §5.6, §8.5). Função pura — sem I/O, sem mocks.
import { describe, it, expect } from 'vitest';
import type { ItemProducao } from '@cobranca/shared';
import { checar, ALERTA_ESPECIALIDADE_AUSENTE, LIMIAR_VARIACAO } from '../../../src/server/engine/conferencia';

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

// Achado 2026-09-02 (auditoria da contagem 3x1): médico importado da origem entra com
// `especialidade: null` e TODAS as regras específicas (3x1, exceções) desligam em silêncio — o
// operador não tinha como saber que a contagem daquele médico rodou pela regra genérica.
describe('checar — especialidade ausente no cadastro (achado 2026-09-02)', () => {
  it('especialidade null COM produção sendo contada → alerta', () => {
    const alertas = checar([item(), item()], 'nao', 2, null, null, 'nao');
    expect(alertas).toContain(ALERTA_ESPECIALIDADE_AUSENTE);
  });

  it('especialidade undefined COM produção → alerta (médico importado sem o campo)', () => {
    const alertas = checar([item()], 'nao', 1, null, undefined, 'nao');
    expect(alertas).toContain(ALERTA_ESPECIALIDADE_AUSENTE);
  });

  it('especialidade string vazia/só espaços COM produção → alerta', () => {
    expect(checar([item()], 'nao', 1, null, '', 'nao')).toContain(ALERTA_ESPECIALIDADE_AUSENTE);
    expect(checar([item()], 'nao', 1, null, '   ', 'nao')).toContain(ALERTA_ESPECIALIDADE_AUSENTE);
  });

  it('especialidade ausente SEM itens sendo contados → NÃO alerta (nada foi contado errado)', () => {
    expect(checar([], 'nao', 0, null, null, 'nao')).not.toContain(ALERTA_ESPECIALIDADE_AUSENTE);
  });

  it('especialidade preenchida (3x1 ou não) → NÃO alerta', () => {
    expect(checar([item()], 'nao', 1, null, 'Pediatra', 'nao')).not.toContain(ALERTA_ESPECIALIDADE_AUSENTE);
    expect(checar([item()], 'nao', 1, null, 'Cirurgia Geral', 'nao')).not.toContain(ALERTA_ESPECIALIDADE_AUSENTE);
  });

  it('não tenta adivinhar grafia errada: especialidade desconhecida mas preenchida não alerta', () => {
    // Detectar "escrita errada" exigiria uma lista canônica confiável que não existe hoje —
    // fora de escopo por decisão explícita (só o caso vazio/nulo é coberto).
    const alertas = checar([item()], 'nao', 1, null, 'Pediátrica', 'nao');
    expect(alertas).not.toContain(ALERTA_ESPECIALIDADE_AUSENTE);
  });
});

describe('checar — regressão dos alertas já existentes', () => {
  it('modo do cadastro divergente do observado (especialidade 3x1) → MODO INCONSISTENTE (PRD §5.3)', () => {
    const alertas = checar([item()], 'nao', 1, null, 'Pediatra', 'sim');
    expect(alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(true);
  });

  it('especialidade não-3x1 nunca dispara MODO INCONSISTENTE, mesmo com modo divergente', () => {
    const alertas = checar([item()], 'nao', 1, null, 'Cirurgia Geral', 'sim');
    expect(alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(false);
  });

  it('procedimento sem código ou sem descrição → alerta de dado incompleto (PRD §5.6)', () => {
    const alertas = checar(
      [item(), { ...item(), codigoProcedimento: '' }, { ...item(), descricaoProcedimento: '' }],
      'nao',
      3,
      null,
      'Cirurgia Geral',
      'nao',
    );
    expect(alertas.some((a) => a.includes('2 procedimento(s) sem código ou descrição'))).toBe(true);
  });

  it(`variação acima de ${LIMIAR_VARIACAO * 100}% vs. mês anterior → alerta (PRD §8.5)`, () => {
    const alertas = checar([item()], 'nao', 20, 10, 'Cirurgia Geral', 'nao');
    expect(alertas.some((a) => a.includes('VARIAÇÃO ALTA'))).toBe(true);
  });

  it('cadastro completo e dado íntegro → nenhum alerta', () => {
    expect(checar([item()], 'nao', 1, null, 'Cirurgia Geral', 'nao')).toEqual([]);
  });
});
