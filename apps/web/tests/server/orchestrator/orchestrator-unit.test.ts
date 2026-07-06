// Testes UNITÁRIOS do Orchestrator — lógica pura de lotes e decisão de continuar/concluir,
// isolando rede/banco com dependências em memória (fake-deps). Sem Supabase, sem fetch.
import { describe, it, expect } from 'vitest';
import {
  numeroDeLotes,
  calcularProgresso,
  iniciarExecucao,
  processarProximoLote,
  BATCH_SIZE,
} from '../../../src/server/orchestrator/execucao-orchestrator';
import { novoEstado, medicoFake, fakeDeps } from './fake-deps';

describe('numeroDeLotes (lógica pura de divisão)', () => {
  it('120 médicos / lote 20 = 6 lotes (calibração da arquitetura)', () => {
    expect(numeroDeLotes(120, 20)).toBe(6);
  });
  it('arredonda para cima quando não divide exato', () => {
    expect(numeroDeLotes(45, 20)).toBe(3);
  });
  it('zero médicos = zero lotes', () => {
    expect(numeroDeLotes(0, 20)).toBe(0);
  });
  it('BATCH_SIZE exportado é 20', () => {
    expect(BATCH_SIZE).toBe(20);
  });
});

describe('calcularProgresso', () => {
  it('metade processada = 50%', () => {
    expect(calcularProgresso(60, 120)).toBe(50);
  });
  it('total zero = 100% (nada a fazer)', () => {
    expect(calcularProgresso(0, 0)).toBe(100);
  });
  it('nunca passa de 100', () => {
    expect(calcularProgresso(130, 120)).toBe(100);
  });
});

describe('iniciarExecucao', () => {
  it('cria execução com as seleções passadas e status processando', async () => {
    const medicos = [
      medicoFake({ id: '1', cpf: '00000000001', nome: 'A' }),
      medicoFake({ id: '2', cpf: '00000000002', nome: 'B' }),
    ];
    const selecoes = [
      { medicoId: '1', producaoExternaId: 'p1', producaoNome: 'Prod 1' },
      { medicoId: '2', producaoExternaId: 'p2', producaoNome: 'Prod 2' },
    ];
    const state = novoEstado(medicos);
    const deps = fakeDeps(state, 20, processarProximoLote);
    const exec = await iniciarExecucao('2026-06', selecoes, 'user-1', deps);
    expect(exec.status).toBe('processando');
    expect(exec.totalMedicos).toBe(2);
    expect(state.selecoes.length).toBe(2);
  });
});

describe('processarProximoLote — decisão de continuar/concluir', () => {
  it('com mais médicos que o lote, processa um lote, NÃO conclui e agenda o próximo', async () => {
    const medicos = Array.from({ length: 5 }, (_, i) =>
      medicoFake({ id: String(i), cpf: `0000000000${i}`, nome: `M${i}` }),
    );
    const selecoes = medicos.map(m => ({ medicoId: m.id, producaoExternaId: `p${m.id}`, producaoNome: 'P' }));
    
    const state = novoEstado(medicos);
    const deps = fakeDeps(state, 2, processarProximoLote); // lote de 2, sem auto-encadear
    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps);

    const lote = await processarProximoLote(exec.id, deps);
    expect(lote.concluido).toBe(false);
    expect(lote.processadosNoLote).toBe(2);
    expect(state.chamadasProximoLote).toBe(1); // agendou o próximo lote
    expect(state.resultados.get(exec.id)!.length).toBe(2);
  });

  it('no último lote, conclui e NÃO agenda mais lotes', async () => {
    const medicos = [
      medicoFake({ id: '1', cpf: '00000000001', nome: 'A' }),
      medicoFake({ id: '2', cpf: '00000000002', nome: 'B' }),
    ];
    const selecoes = medicos.map(m => ({ medicoId: m.id, producaoExternaId: `p${m.id}`, producaoNome: 'P' }));
    
    const state = novoEstado(medicos);
    const deps = fakeDeps(state, 5, processarProximoLote); // lote maior que o total
    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps);

    const lote = await processarProximoLote(exec.id, deps);
    expect(lote.concluido).toBe(true);
    expect(state.chamadasProximoLote).toBe(0); // não encadeou
    expect(state.execucoes.get(exec.id)!.status).toBe('concluido');
  });

  it('zero seleções → conclui imediatamente', async () => {
    const state = novoEstado([]);
    const deps = fakeDeps(state, 20, processarProximoLote);
    const exec = await iniciarExecucao('2026-06', [], 'u', deps);
    const lote = await processarProximoLote(exec.id, deps);
    expect(lote.concluido).toBe(true);
    expect(state.execucoes.get(exec.id)!.status).toBe('concluido');
  });

  it('falha de rede num médico vira alerta e NÃO derruba o lote', async () => {
    const medicos = [
      medicoFake({ id: '1', cpf: '00000000001', nome: 'A' }),
      medicoFake({ id: '2', cpf: '00000000002', nome: 'B' }),
    ];
    const selecoes = medicos.map(m => ({ medicoId: m.id, producaoExternaId: `p${m.id}`, producaoNome: 'P' }));
    
    const state = novoEstado(medicos);
    state.producoesComFalha.add('p1'); // A falha ao buscar dados (produção p1)
    const deps = fakeDeps(state, 5, processarProximoLote);
    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps);

    await processarProximoLote(exec.id, deps);
    const resultados = state.resultados.get(exec.id)!;
    expect(resultados.length).toBe(2); // ambos gravados
    const a = resultados.find((x) => x.medicoId === '1')!;
    expect(a.r.status).toBe('alerta');
    expect(a.r.alertas[0]).toContain('Falha ao buscar dados');
  });
});
