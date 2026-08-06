// Regressão obrigatória do motor — casos reais validados do PRD §12 (regra de dinheiro).
// Fixtures reproduzem a estrutura dos xlsx originais (Dra. A e Dr. E) já no formato
// ItemProducao do contrato real; atendimentoExternoId faz o papel do numero_atendimento.
import { describe, it, expect } from 'vitest';
import {
  contarGuiasProducao as contarGuias,
  consolidarProducao as consolidarPorAtendimento,
  detectarModoProducao as detectarModo,
} from '../../../src/server/engine/contagem-producao';
import { checar } from '../../../src/server/engine/conferencia';
import { processarMedico } from '../../../src/server/engine/processar-medico';
import { procedimentosDraA, procedimentosDrE } from './fixtures';

describe('PRD §12 — Dra. A (modo SIM, muda data)', () => {
  it('conta 17 guias e 4 cirurgias a partir de 17 procedimentos espalhados', () => {
    const { guias, cirurgias } = contarGuias(procedimentosDraA, 'Pediatra');
    expect(guias).toBe(17);
    expect(cirurgias).toBe(4); // 4 atendimentos distintos (atendimentoExternoId)
  });

  it('consolidado por cirurgia = 6 guias', () => {
    expect(consolidarPorAtendimento(procedimentosDraA, 'Pediatria')).toBe(6);
  });

  it('detecta modo observado = sim (atendimentos com datas espalhadas)', () => {
    // Cada cirurgia da Dra. A tem procedimentos em datas consecutivas → grupo
    // (atendimentoExternoId) com mais de uma data → modo 'sim' (PRD §5.3).
    expect(detectarModo(procedimentosDraA)).toBe('sim');
  });

  it('1 procedimento sem valor → alerta de dado incompleto', () => {
    const alertas = checar(procedimentosDraA, 'sim', 17, null, 'PEDIATRA');
    expect(alertas.some((a) => a.includes('1 procedimento(s) sem código ou descrição'))).toBe(true);
  });

  it('cadastro SIM bate com observado SIM → sem alerta de modo', () => {
    const alertas = checar(procedimentosDraA, 'sim', 17, null, 'PEDIATRA', 'sim');
    expect(alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(false);
  });

  it('processarMedico: status alerta (por dado incompleto), 17 guias, 6 consolidado', () => {
    const r = processarMedico({
      medico: {
        id: 'a', cpf: '00000000001', nome: 'Dra. Ana Martins',
        statusHapvida: 'credenciado', fazOutrosHospitais: false,
        fazImobilizacoes: false, modoMudancaData: 'sim',
        especialidade: 'Pediatra',
      } as any,
      itens: procedimentosDraA,
    });
    expect(r.guias).toBe(17);
    expect(r.guiasConsolidado).toBe(6);
    expect(r.procedimentos).toBe(17);
    expect(r.status).toBe('alerta');
  });

  it('processarMedico NÃO gera alerta falso de modo (cadastro sim = observado sim)', () => {
    const r = processarMedico({
      medico: {
        id: 'a', cpf: '00000000001', nome: 'Dra. Ana Martins',
        statusHapvida: 'credenciado', fazOutrosHospitais: false,
        fazImobilizacoes: false, modoMudancaData: 'sim',
        especialidade: 'Pediatra',
      } as any,
      itens: procedimentosDraA,
    });
    expect(r.alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(false);
  });
});

describe('PRD §12 — Dr. E (modo NÃO, não muda data)', () => {
  it('conta 17 guias a partir de 49 procedimentos na mesma data', () => {
    const { guias } = contarGuias(procedimentosDrE, 'Pediatria');
    expect(guias).toBe(17);
  });

  it('detecta modo observado = nao (cada atendimento numa única data)', () => {
    expect(detectarModo(procedimentosDrE)).toBe('nao');
  });

  it('6 procedimentos sem valor → alerta de dado incompleto', () => {
    const alertas = checar(procedimentosDrE, 'nao', 17, null, 'PEDIATRIA');
    expect(alertas.some((a) => a.includes('6 procedimento(s) sem código ou descrição'))).toBe(true);
  });

  it('cadastro SIM mas observado NÃO → alerta de modo inconsistente', () => {
    const alertas = checar(procedimentosDrE, 'sim', 17, null, 'PEDIATRIA', 'nao');
    expect(alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(true);
  });

  it('processarMedico: 17 guias, 49 procedimentos', () => {
    const r = processarMedico({
      medico: {
        id: 'e', cpf: '00000000002', nome: 'Dr. E',
        statusHapvida: 'credenciado', fazOutrosHospitais: false,
        fazImobilizacoes: false, modoMudancaData: 'nao',
        especialidade: 'Pediatra',
      } as any,
      itens: procedimentosDrE,
    });
    expect(r.guias).toBe(17);
    expect(r.procedimentos).toBe(49);
    expect(r.status).toBe('alerta'); // 6 sem valor
  });
});

describe('Regra de Outras Especialidades (Não Pediatra)', () => {
  it('aplica 1 guia por procedimento e ignora modoMudancaData', () => {
    const r = processarMedico({
      medico: {
        id: 'x', cpf: '00000000003', nome: 'Dr. Coração',
        statusHapvida: 'credenciado', fazOutrosHospitais: false,
        fazImobilizacoes: false, modoMudancaData: 'sim',
        especialidade: 'Cardiologia',
      } as any,
      itens: procedimentosDrE, // mesmos 49 procedimentos do Dr. E
    });
    // Pediatra contaria 17; não-pediatra é 1 guia por procedimento.
    expect(r.guias).toBe(49);
    expect(r.procedimentos).toBe(49);
    expect(r.guiasConsolidado).toBe(49);
    // Alerta de modo é regra exclusiva das especialidades 3x1 (PRD §5.3 + GATE 2026-08-06).
    expect(r.alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(false);
  });
});

describe('MODO INCONSISTENTE em ginecologista/urologista/ortopedista (GATE 2026-08-06)', () => {
  it.each(['Ginecologista', 'Urologista', 'Ortopedista'])(
    '%s: cadastro SIM mas observado NÃO → alerta de modo inconsistente (mesmo agrupamento 3x1 do pediatra)',
    (especialidade) => {
      const alertas = checar(procedimentosDrE, 'sim', 17, null, especialidade, 'nao');
      expect(alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(true);
    },
  );

  it.each(['Ginecologista', 'Urologista', 'Ortopedista'])(
    '%s: cadastro bate com observado → sem alerta de modo',
    (especialidade) => {
      const alertas = checar(procedimentosDraA, 'sim', 17, null, especialidade, 'sim');
      expect(alertas.some((a) => a.includes('MODO INCONSISTENTE'))).toBe(false);
    },
  );
});
