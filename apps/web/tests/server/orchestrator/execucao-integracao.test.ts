// Teste de INTEGRAÇÃO — fluxo completo de uma execução pequena (3 médicos fictícios),
// modo local do Integration Client (fixtures), do disparo até o relatório em 3 grupos.
// Usa o Engine REAL e o fluxo REAL do Orchestrator (com encadeamento de lotes simulado).
// NÃO depende da API real da Carmem (bloqueador externo do PRD §11, segue de pé).
import { describe, it, expect } from 'vitest';
import type { Procedimento, ResultadoMedico } from '@cobranca/shared';
import {
  iniciarExecucao,
  processarProximoLote,
} from '../../../src/server/orchestrator/execucao-orchestrator';
import { novoEstado, medicoFake, fakeDeps, type FakeState } from './fake-deps';
import { procedimentosDraA } from '../engine/fixtures';

// Médico OK: poucos procedimentos, modo bate, todos com valor → status ok.
function procedimentosOk(cpf: string): Procedimento[] {
  return [
    {
      cpfMedico: cpf,
      numeroAtendimento: 'AT-1',
      senhaProcedimento: 'S1',
      dataEmissao: '2026-06-10',
      dataProcedimento: '2026-06-10',
      tipo: 'M',
      descricaoProcedimento: 'Proc',
      codigoProcedimento: '1',
      valor: 100,
      localAtendimento: 'H',
      plano: 'Hapvida',
    },
    {
      cpfMedico: cpf,
      numeroAtendimento: 'AT-1',
      senhaProcedimento: 'S2',
      dataEmissao: '2026-06-10',
      dataProcedimento: '2026-06-10',
      tipo: 'A1',
      descricaoProcedimento: 'Proc',
      codigoProcedimento: '2',
      valor: 100,
      localAtendimento: 'H',
      plano: 'Hapvida',
    },
    {
      cpfMedico: cpf,
      numeroAtendimento: 'AT-1',
      senhaProcedimento: 'S3',
      dataEmissao: '2026-06-10',
      dataProcedimento: '2026-06-10',
      tipo: 'A2',
      descricaoProcedimento: 'Proc',
      codigoProcedimento: '3',
      valor: 100,
      localAtendimento: 'H',
      plano: 'Hapvida',
    },
  ];
}

function montarCenario(): { state: FakeState } {
  const medicos = [
    // OK — credenciado, modo NÃO, dados completos
    medicoFake({ id: 'm-ok', cpf: '11111111111', nome: 'Dr. OK', modoMudancaData: 'nao' }),
    // ALERTA — usa fixture da Dra. A (modo SIM, 1 proc sem valor)
    medicoFake({ id: 'm-alerta', cpf: '00000000001', nome: 'Dra. A', modoMudancaData: 'sim', especialidade: 'Pediatra' }),
    // SEM_DADOS — nenhum procedimento retornado
    medicoFake({ id: 'm-sem', cpf: '99999999999', nome: 'Dr. Sem Dados', modoMudancaData: 'nao' }),
  ];
  const state = novoEstado(medicos);
  state.procedimentosPorCpf['11111111111'] = procedimentosOk('11111111111');
  state.procedimentosPorCpf['00000000001'] = procedimentosDraA;
  // 99999999999 → sem entrada = array vazio = sem_dados
  return { state };
}

function classificar(resultados: ResultadoMedico[]) {
  return {
    ok: resultados.filter((r) => r.status === 'ok'),
    alerta: resultados.filter((r) => r.status === 'alerta'),
    semDados: resultados.filter((r) => r.status === 'sem_dados'),
  };
}

describe('Integração — execução completa em 3 grupos (modo local)', () => {
  it('processa 3 médicos do disparo ao relatório, classificando ok/alerta/sem_dados', async () => {
    const { state } = montarCenario();
    // batchSize 2 força 2 lotes (3 médicos) e exercita o encadeamento auto.
    const deps = fakeDeps(state, 2, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', 'colaborador-1', deps);
    expect(exec.totalMedicos).toBe(3);

    // Dispara o primeiro lote; autoEncadear roda o restante até concluir.
    await processarProximoLote(exec.id, deps);

    const final = state.execucoes.get(exec.id)!;
    expect(final.status).toBe('concluido');
    expect(final.progresso).toBe(100);

    const resultados = state.resultados.get(exec.id)!.map((x) => x.r);
    expect(resultados.length).toBe(3);

    const { ok, alerta, semDados } = classificar(resultados);
    expect(ok.map((r) => r.nome)).toEqual(['Dr. OK']);
    expect(alerta.map((r) => r.nome)).toEqual(['Dra. A']);
    expect(semDados.map((r) => r.nome)).toEqual(['Dr. Sem Dados']);

    // Os totais agregados na execução refletem os 3 grupos.
    expect(final.totalOk).toBe(1);
    expect(final.totalAlerta).toBe(1);
    expect(final.totalSemDados).toBe(1);

    // A Dra. A reproduz a regressão do PRD §12 dentro do fluxo de execução.
    const draA = alerta[0]!;
    expect(draA.guias).toBe(17);
    expect(draA.cirurgias).toBe(4);
    expect(draA.guiasConsolidado).toBe(6);
    expect(draA.alertas.some((a) => a.includes('sem valor'))).toBe(true);

    // Encadeou exatamente uma vez (lote 1 → agenda lote 2; lote 2 conclui).
    expect(state.chamadasProximoLote).toBe(1);
  });

  it('detecta variação anômala (>40%) usando guias da execução anterior', async () => {
    const { state } = montarCenario();
    // Mês anterior o Dr. OK teve 1 guia; agora terá 1 (3 procs / 3 = 1) → sem variação.
    // Forçamos histórico baixo para a Dra. A (17 guias agora vs 5 antes = 240% → alerta).
    state.guiasAnterioresPorCpf['00000000001'] = 5;
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', 'u', deps);
    await processarProximoLote(exec.id, deps);

    const draA = state.resultados.get(exec.id)!.map((x) => x.r).find((r) => r.cpf === '00000000001')!;
    expect(draA.alertas.some((a) => a.includes('VARIAÇÃO ALTA'))).toBe(true);
  });
});
