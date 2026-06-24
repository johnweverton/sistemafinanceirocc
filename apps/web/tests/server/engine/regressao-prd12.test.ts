// Teste de regressão OBRIGATÓRIO do motor — casos reais do PRD §12.
// O motor portado deve reproduzir EXATAMENTE esses números. Se quebrar, o port regrediu.
import { describe, it, expect } from 'vitest';
import {
  contarGuias,
  consolidarPorAtendimento,
  detectarModo,
  checar,
  processarMedico,
} from '../../../src/server/engine';
import { procedimentosDraA, procedimentosDrE } from './fixtures';

describe('PRD §12 — Dra. A (modo SIM, muda data)', () => {
  it('conta 17 guias e 4 cirurgias a partir de 17 procedimentos espalhados', () => {
    const { guias, cirurgias } = contarGuias(procedimentosDraA);
    expect(guias).toBe(17);
    expect(cirurgias).toBe(4);
  });

  it('consolidado por cirurgia = 6 guias', () => {
    expect(consolidarPorAtendimento(procedimentosDraA)).toBe(6);
  });

  it('detecta modo observado = sim (datas espalhadas)', () => {
    expect(detectarModo(procedimentosDraA)).toBe('sim');
  });

  it('1 procedimento sem valor → alerta de dado incompleto', () => {
    const alertas = checar(procedimentosDraA, 'sim', 17);
    expect(alertas.some((a) => a.includes('1 procedimento(s) sem valor'))).toBe(true);
  });

  it('cadastro SIM bate com observado SIM → sem alerta de modo', () => {
    const alertas = checar(procedimentosDraA, 'sim', 17);
    expect(alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(false);
  });

  it('processarMedico: status alerta (por dado incompleto), 17 guias, 6 consolidado', () => {
    const r = processarMedico({
      medico: {
        id: 'a', cpf: '00000000001', nome: 'Dra. Ana Martins',
        statusHapvida: 'credenciado', fazOutrosHospitais: false,
        fazImobilizacoes: false, modoMudancaData: 'sim',
      },
      procedimentos: procedimentosDraA,
    });
    expect(r.guias).toBe(17);
    expect(r.cirurgias).toBe(4);
    expect(r.guiasConsolidado).toBe(6);
    expect(r.procedimentos).toBe(17);
    expect(r.status).toBe('alerta');
  });
});

describe('PRD §12 — Dr. E (modo NÃO, não muda data)', () => {
  it('conta 17 guias e 16 cirurgias a partir de 49 procedimentos na mesma data', () => {
    const { guias, cirurgias } = contarGuias(procedimentosDrE);
    expect(guias).toBe(17);
    expect(cirurgias).toBe(16);
  });

  it('detecta modo observado = nao (data única por cirurgia)', () => {
    expect(detectarModo(procedimentosDrE)).toBe('nao');
  });

  it('6 procedimentos sem valor → alerta de dado incompleto', () => {
    const alertas = checar(procedimentosDrE, 'nao', 17);
    expect(alertas.some((a) => a.includes('6 procedimento(s) sem valor'))).toBe(true);
  });

  it('cadastro NÃO mas se fosse SIM → alerta de modo inconsistente', () => {
    const alertas = checar(procedimentosDrE, 'sim', 17);
    expect(alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(true);
  });

  it('processarMedico: 17 guias, 49 procedimentos, 16 cirurgias', () => {
    const r = processarMedico({
      medico: {
        id: 'e', cpf: '00000000002', nome: 'Dr. E',
        statusHapvida: 'credenciado', fazOutrosHospitais: false,
        fazImobilizacoes: false, modoMudancaData: 'nao',
      },
      procedimentos: procedimentosDrE,
    });
    expect(r.guias).toBe(17);
    expect(r.procedimentos).toBe(49);
    expect(r.cirurgias).toBe(16);
    expect(r.status).toBe('alerta'); // 6 sem valor
  });
});
