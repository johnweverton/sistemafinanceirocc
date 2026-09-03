// Teste de INTEGRAÇÃO — fluxo completo de uma execução pequena (3 médicos fictícios),
// modo local do Integration Client (fixtures), do disparo até o relatório em 3 grupos.
// Usa o Engine REAL e o fluxo REAL do Orchestrator (com encadeamento de lotes simulado).
// NÃO depende da API real da Carmem (bloqueador externo do PRD §11, segue de pé).
import { describe, it, expect } from 'vitest';
import type { ItemProducao, ResultadoMedico } from '@cobranca/shared';
import {
  iniciarExecucao,
  processarProximoLote,
} from '../../../src/server/orchestrator/execucao-orchestrator';
import { novoEstado, medicoFake, empresaFake, fakeDeps, type FakeState } from './fake-deps';
import { procedimentosDraA } from '../engine/fixtures';

// Médico OK: poucos procedimentos, modo bate, todos com valor → status ok. 5 atendimentos
// DISTINTOS (não 3) desde o GATE 2026-08-13 — mínimo de guias combinadas pra gerar boleto.
function procedimentosOk(): ItemProducao[] {
  return Array.from({ length: 5 }, (_, i) => ({
    data: '2026-06-10',
    pacienteNome: `Paciente ${i + 1}`,
    atendimentoExternoId: `AT-${i + 1}`,
    codigoProcedimento: '1',
    descricaoProcedimento: 'Proc',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
  }));
}

function montarCenario(): { state: FakeState; selecoes: any[] } {
  const medicos = [
    // OK — credenciado, modo NÃO, dados completos
    medicoFake({ id: 'm-ok', cpf: '11111111111', nome: 'Dr. OK', modoMudancaData: 'nao' }),
    // ALERTA — usa fixture da Dra. A (modo SIM, 1 proc sem valor)
    medicoFake({ id: 'm-alerta', cpf: '00000000001', nome: 'Dra. A', modoMudancaData: 'sim', especialidade: 'Pediatra' }),
    // SEM_DADOS — nenhum procedimento retornado
    medicoFake({ id: 'm-sem', cpf: '99999999999', nome: 'Dr. Sem Dados', modoMudancaData: 'nao' }),
  ];
  const selecoes = [
    { medicoId: 'm-ok', producaoExternaId: 'p-ok', producaoNome: 'Prod OK' },
    { medicoId: 'm-alerta', producaoExternaId: 'p-alerta', producaoNome: 'Prod Alerta' },
    { medicoId: 'm-sem', producaoExternaId: 'p-sem', producaoNome: 'Prod Sem' },
  ];

  const state = novoEstado(medicos);
  state.itensPorProducao['p-ok'] = procedimentosOk();
  state.itensPorProducao['p-alerta'] = procedimentosDraA;
  // p-sem → sem entrada = array vazio = sem_dados
  return { state, selecoes };
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
    const { state, selecoes } = montarCenario();
    // batchSize 2 força 2 lotes (3 médicos) e exercita o encadeamento auto.
    const deps = fakeDeps(state, 2, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', selecoes, 'colaborador-1', deps);
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
    expect(draA.guiasConsolidado).toBe(6);
    expect(draA.alertas.some((a) => a.includes('sem código ou descrição'))).toBe(true);

    // Encadeou exatamente uma vez (lote 1 → agenda lote 2; lote 2 conclui).
    expect(state.chamadasProximoLote).toBe(1);
  });

  it('detecta variação anômala (>40%) usando guias da execução anterior', async () => {
    const { state, selecoes } = montarCenario();
    // Mês anterior o Dr. OK teve 1 guia; agora terá 1 (3 procs / 3 = 1) → sem variação.
    // Forçamos histórico baixo para a Dra. A (17 guias agora vs 5 antes = 240% → alerta).
    state.guiasAnterioresPorMedicoId['m-alerta'] = 5;
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps);
    await processarProximoLote(exec.id, deps);

    const draA = state.resultados.get(exec.id)!.map((x) => x.r).find((r) => r.cpf === '00000000001')!;
    expect(draA.alertas.some((a) => a.includes('VARIAÇÃO ALTA'))).toBe(true);
  });

  it('Story 10.2 — pediatra com produção de consultas separada: soma ao valor de guias, fim a fim', async () => {
    const pediatra = medicoFake({
      id: 'm-pediatra',
      cpf: '33344455566',
      nome: 'Dra. Alessandra',
      especialidade: 'Pediatria',
      statusHapvida: 'credenciado',
    });
    const state = novoEstado([pediatra]);
    // 5 guias credenciado (mínimo, GATE 2026-08-13; até 30 → R$263,59) em produção separada da
    // de consultas.
    state.itensPorProducao['p-guias'] = [
      { data: '2026-06-01', pacienteNome: 'G1', atendimentoExternoId: null, codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar', statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo', valorCobradoOrigem: 100, valorPagoOrigem: 100 },
      { data: '2026-06-02', pacienteNome: 'G2', atendimentoExternoId: null, codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar', statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo', valorCobradoOrigem: 100, valorPagoOrigem: 100 },
      { data: '2026-06-03', pacienteNome: 'G3', atendimentoExternoId: null, codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar', statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo', valorCobradoOrigem: 100, valorPagoOrigem: 100 },
      { data: '2026-06-04', pacienteNome: 'G4', atendimentoExternoId: null, codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar', statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo', valorCobradoOrigem: 100, valorPagoOrigem: 100 },
      { data: '2026-06-05', pacienteNome: 'G5', atendimentoExternoId: null, codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar', statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo', valorCobradoOrigem: 100, valorPagoOrigem: 100 },
    ];
    // 10 consultas × R$3,00 (default) = R$30,00 — lote SEPARADO, nunca somado às guias.
    state.itensPorProducao['p-consultas'] = Array.from({ length: 10 }, (_, i) => ({
      data: '2026-06-10', pacienteNome: `Consulta ${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30721033', descricaoProcedimento: 'Consulta em consultório',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 150, valorPagoOrigem: 130,
    }));

    const selecoes = [
      {
        medicoId: 'm-pediatra',
        producaoExternaId: 'p-guias',
        producaoNome: 'Junho 2026',
        producaoConsultasExternaId: 'p-consultas',
        producaoConsultasNome: 'Consultas Junho 2026',
      },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps);
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultados.get(exec.id)!.map((x) => x.r)[0]!;
    expect(resultado.guias).toBe(5);
    expect(resultado.totalValor).toBeCloseTo(263.59 + 30, 2);
    expect(resultado.subtotais.find((s) => s.classe === 'CONSULTA_PEDIATRIA')).toMatchObject({
      guias: 10,
      valor: 30,
    });
    expect(resultado.status).toBe('ok');
  });

  // Achado 2026-08-13 (regra da coordenadora financeira): guias abaixo do mínimo NÃO travam as
  // consultas — elas são um componente independente (unidade "consulta", não "guia") e sempre
  // bilham quando existirem, mesmo com as guias hospitalares sendo retidas em paralelo. Senão um
  // pediatra que só faz consultas ambulatoriais (guias sempre 0) nunca mais seria cobrado.
  it('Story 10.2 + GATE 2026-08-13 — guias abaixo do mínimo ficam retidas, mas consultas bilham mesmo assim', async () => {
    const pediatra = medicoFake({
      id: 'm-pediatra-2',
      cpf: '77788899900',
      nome: 'Dr. Retido',
      especialidade: 'Pediatria',
      statusHapvida: 'credenciado',
    });
    const state = novoEstado([pediatra]);
    // Só 3 guias — abaixo do mínimo de 5 (GATE 2026-08-13).
    state.itensPorProducao['p-guias'] = [
      { data: '2026-06-01', pacienteNome: 'G1', atendimentoExternoId: null, codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar', statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo', valorCobradoOrigem: 100, valorPagoOrigem: 100 },
      { data: '2026-06-02', pacienteNome: 'G2', atendimentoExternoId: null, codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar', statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo', valorCobradoOrigem: 100, valorPagoOrigem: 100 },
      { data: '2026-06-03', pacienteNome: 'G3', atendimentoExternoId: null, codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar', statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo', valorCobradoOrigem: 100, valorPagoOrigem: 100 },
    ];
    state.itensPorProducao['p-consultas'] = Array.from({ length: 10 }, (_, i) => ({
      data: '2026-06-10', pacienteNome: `Consulta ${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30721033', descricaoProcedimento: 'Consulta em consultório',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 150, valorPagoOrigem: 130,
    }));

    const selecoes = [
      {
        medicoId: 'm-pediatra-2',
        producaoExternaId: 'p-guias',
        producaoNome: 'Junho 2026',
        producaoConsultasExternaId: 'p-consultas',
        producaoConsultasNome: 'Consultas Junho 2026',
      },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps);
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultados.get(exec.id)!.map((x) => x.r)[0]!;
    // Só as consultas bilham este mês — as 3 guias ficam retidas (não aparecem em subtotais/valor).
    expect(resultado.totalValor).toBe(30);
    expect(resultado.status).toBe('ok');
    expect(resultado.subtotais).toEqual([{ classe: 'CONSULTA_PEDIATRIA', guias: 10, valor: 30, faixa: expect.any(String) }]);
    expect(resultado.alertas.some((a) => a.includes('abaixo do mínimo'))).toBe(true);

    // O saldo fica retido pro médico, pronto pra somar na próxima competência processada.
    const saldo = state.saldosAcumulados.get('m-pediatra-2');
    expect(saldo?.guiasPrincipal).toBe(3);
  });

  // Achado real 2026-08-21 (caso do Humberto Bia): a produção mensal do pediatra pode ter a
  // MESMA estrutura de sub-lotes do Angiologista (fin-lotes) — ex.: dentro de "JULHO - 2026" há
  // sub-lotes "HUMBERTO 1Q"/"HUMBERTO 2Q" (guias) e "HUMBERTO CONSULTAS DE JUNHO" (consultas),
  // tudo somado no pacote completo da produção mensal. Escolher o sub-lote de consulta separado
  // SEM também trocar o principal pra "soma dos outros sub-lotes" contaria esses itens 2x (uma
  // vez dentro do pacote completo, uma vez como consulta) — o item da origem não carrega um
  // campo "pertence ao sub-lote X" pra filtrar depois.
  it('Achado 2026-08-21 — pediatra com sub-lote de consulta DENTRO da produção mensal: guia principal vem só dos OUTROS sub-lotes (nunca do pacote completo)', async () => {
    const pediatra = medicoFake({
      id: 'm-pediatra-3',
      cpf: '11122233344',
      nome: 'Dr. Humberto',
      especialidade: 'Pediatria',
      statusHapvida: 'credenciado',
    });
    const state = novoEstado([pediatra]);

    // "Pacote completo" da produção mensal (fin-producoes, flat) — o que `buscarItens` devolveria
    // se alguém (bug de regressão) reaproveitasse `producaoExternaId` junto com os sub-lotes.
    // Deliberadamente MUITO diferente da soma dos sub-lotes abaixo (60 itens vs 5), pra qualquer
    // vazamento do pacote completo estourar nos asserts de guias/valor.
    state.itensPorProducao['p-julho-completa'] = Array.from({ length: 60 }, (_, i) => ({
      data: '2026-07-01', pacienteNome: `Pacote ${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));

    // Sub-lotes de guia: "1Q" (3) + "2Q" (2) = 5 guias combinadas (bate o mínimo, GATE 2026-08-13).
    state.itensPorLote['lote-1q'] = Array.from({ length: 3 }, (_, i) => ({
      data: '2026-07-05', pacienteNome: `1Q-${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));
    state.itensPorLote['lote-2q'] = Array.from({ length: 2 }, (_, i) => ({
      data: '2026-07-20', pacienteNome: `2Q-${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));
    // Sub-lote de consulta: 10 consultas × R$3,00 (default) = R$30,00.
    state.itensPorLote['lote-consultas'] = Array.from({ length: 10 }, (_, i) => ({
      data: '2026-07-10', pacienteNome: `Consulta ${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30721033', descricaoProcedimento: 'Consulta em consultório',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 150, valorPagoOrigem: 130,
    }));

    const selecoes = [
      {
        medicoId: 'm-pediatra-3',
        // Achado 2026-08-21: producaoExternaId vai null — o principal vem 100% dos sub-lotes.
        producaoExternaId: null,
        producaoNome: null,
        producaoConsultasLoteExternaIds: ['lote-consultas'],
        producaoConsultasLoteNomes: ['HUMBERTO CONSULTAS DE JUNHO'],
        producaoGuiasLoteExternaIds: ['lote-1q', 'lote-2q'],
        producaoGuiasLoteNomes: ['HUMBERTO 1Q', 'HUMBERTO 2Q'],
      },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-07', selecoes, 'u', deps);
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultados.get(exec.id)!.map((x) => x.r)[0]!;
    // 5 guias (1Q+2Q) — NUNCA os 60 do pacote completo (prova que producaoExternaId não foi usado).
    expect(resultado.guias).toBe(5);
    expect(resultado.totalValor).toBeCloseTo(263.59 + 30, 2);
    expect(resultado.subtotais.find((s) => s.classe === 'CONSULTA_PEDIATRIA')).toMatchObject({
      guias: 10,
      valor: 30,
    });
    expect(resultado.status).toBe('ok');
  });

  it('Achado 2026-08-21 — pediatra com sub-lotes disponíveis mas NENHUM marcado como consulta: comportamento inalterado (usa o pacote completo, sem regressão)', async () => {
    const pediatra = medicoFake({
      id: 'm-pediatra-4',
      cpf: '55566677788',
      nome: 'Dra. Sem Sub-lote Marcado',
      especialidade: 'Pediatria',
      statusHapvida: 'credenciado',
    });
    const state = novoEstado([pediatra]);
    state.itensPorProducao['p-julho-completa'] = Array.from({ length: 5 }, (_, i) => ({
      data: '2026-07-01', pacienteNome: `G${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));
    // Sub-lotes existem na origem (ex.: a UI buscou pra popular o seletor), mas o operador não
    // marcou nenhum como consulta — `producaoGuiasLoteExternaIds`/`producaoConsultasLoteExternaIds`
    // ficam ausentes, e o motor deve continuar usando o pacote completo, exatamente como antes
    // desta feature.
    const selecoes = [
      { medicoId: 'm-pediatra-4', producaoExternaId: 'p-julho-completa', producaoNome: 'Julho - 2026' },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-07', selecoes, 'u', deps);
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultados.get(exec.id)!.map((x) => x.r)[0]!;
    expect(resultado.guias).toBe(5);
    expect(resultado.totalValor).toBeCloseTo(263.59, 2);
    expect(resultado.subtotais.some((s) => s.classe === 'CONSULTA_PEDIATRIA')).toBe(false);
  });

  // Migration 0058 (aprovado 2026-09-03): execução MISTA — na MESMA competência, parte dos médicos
  // é processada pelo motor normal e parte entra com o total de guias já conferido à mão pelo dono
  // (planilha). Exercita o caminho inteiro (seleção → orquestrador → Engine), que é onde o achado
  // A1 (2026-09-02) mostrou que um campo novo pode ser esquecido no meio.
  it('Migration 0058 — execução mista: um médico com contagem manual, outro no fluxo automático', async () => {
    const producao = (n: number, prefixo: string) =>
      Array.from({ length: n }, (_, i) => ({
        data: '2026-06-10',
        pacienteNome: `${prefixo}-${i}`,
        atendimentoExternoId: `AT-${prefixo}-${i}`,
        codigoProcedimento: '30715040',
        descricaoProcedimento: 'Visita hospitalar',
        statusOrigem: 'Devidamente Pago',
        viaAcesso: false,
        tipoAto: 'Eletivo',
        valorCobradoOrigem: 100,
        valorPagoOrigem: 100,
      }));

    const state = novoEstado([
      medicoFake({ id: 'm-manual', cpf: '11144477735', nome: 'Dr. Conferido a Mao', statusHapvida: 'credenciado' }),
      medicoFake({ id: 'm-auto', cpf: '98765432100', nome: 'Dr. Automatico', statusHapvida: 'credenciado' }),
    ]);
    state.itensPorProducao['p-manual'] = producao(10, 'M');
    state.itensPorProducao['p-auto'] = producao(10, 'A');

    const selecoes = [
      {
        medicoId: 'm-manual',
        producaoExternaId: 'p-manual',
        producaoNome: 'Junho 2026',
        guiasManuaisTotal: 42,
        guiasManuaisMotivo: 'Conferencia manual do dono',
      },
      { medicoId: 'm-auto', producaoExternaId: 'p-auto', producaoNome: 'Junho 2026' },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps);
    await processarProximoLote(exec.id, deps);

    const porMedico = new Map(state.resultados.get(exec.id)!.map((x) => [x.medicoId, x.r]));
    const manual = porMedico.get('m-manual')!;
    const automatico = porMedico.get('m-auto')!;

    // Mesmíssima produção (10 itens) nos dois: só o da planilha sai com 42.
    expect(manual.guias).toBe(42);
    expect(manual.totalValor).toBe(394.12); // faixa até 50, credenciado
    expect(manual.alertas[0]).toContain('CONTAGEM MANUAL (planilha): 42 guia(s)');
    expect(manual.alertas[0]).toContain('Conferencia manual do dono');
    // GATE do dono 2026-09-03: a marca é auditoria, não pendência — sai 'ok', pronto pra emitir
    // sem passar pelo "Revisar e liberar" (emissão exige status 'ok').
    expect(manual.status).toBe('ok');

    expect(automatico.guias).toBe(10);
    expect(automatico.totalValor).toBe(263.59); // faixa até 30, credenciado
    expect(automatico.alertas.some((a) => a.includes('CONTAGEM MANUAL'))).toBe(false);
  });

  // Achado 2026-08-25 (migration 0059: virou ARRAY): mesmo caso do Humberto (sub-lote de consulta
  // acima), mas para Imobilizações — a produção mensal do médico pode ter sub-lote(s) de
  // imobilizações (ex.: "1º QUINZENA IMOBILIZAÇÕES") dentro dela, em vez de vir como produção de
  // nível-topo separada. Ao contrário de Consultas, escolher o(s) sub-lote(s) NÃO precisa
  // recalcular "guias restantes": Imobilizações já é classe totalmente separada da produção
  // principal — o teste prova que o motor busca via `buscarItensPorLote` (loteId), nunca
  // `buscarItens` (producaoId) reaproveitando a produção flat que teria o mesmo nome/competência.
  it('Achado 2026-08-25 — médico com sub-lote de Imobilizações DENTRO da produção mensal: usa o lote (buscarItensPorLote), nunca a produção flat', async () => {
    const medico = medicoFake({
      id: 'm-imob-lote',
      cpf: '22233344455',
      nome: 'Dr. Sub-lote Imobilizações',
      fazImobilizacoes: true,
      especialidade: 'Ortopedia',
    });
    const state = novoEstado([medico]);

    // Produção flat (fin-producoes) com nome parecido, usada só pro lote PRINCIPAL — prova de
    // que ela nunca é lida como fonte de Imobilizações.
    state.itensPorProducao['p-julho-completa'] = Array.from({ length: 5 }, (_, i) => ({
      data: '2026-07-01', pacienteNome: `G${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));
    // Sub-lote de Imobilizações (fin-lotes) — 4 itens, deliberadamente diferente da produção
    // flat acima pra qualquer vazamento estourar no assert de guias.
    state.itensPorLote['lote-imob'] = Array.from({ length: 4 }, (_, i) => ({
      data: '2026-07-12', pacienteNome: `Imob-${i}`, atendimentoExternoId: null,
      codigoProcedimento: '31309054', descricaoProcedimento: 'Imobilização',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));

    const selecoes = [
      {
        medicoId: 'm-imob-lote',
        producaoExternaId: 'p-julho-completa',
        producaoNome: 'Julho - 2026',
        producaoImobilizacoesLoteExternaIds: ['lote-imob'],
        producaoImobilizacoesLoteNomes: ['1º QUINZENA IMOBILIZAÇÕES'],
      },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-07', selecoes, 'u', deps);
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultados.get(exec.id)!.map((x) => x.r)[0]!;
    // Principal (HAPVIDA_CRED) vem da produção flat, como sempre.
    expect(resultado.subtotais.find((s) => s.classe === 'HAPVIDA_CRED')).toMatchObject({ guias: 5 });
    // Imobilizações vem do SUB-LOTE (4), nunca reaproveitando a produção flat (5).
    expect(resultado.subtotais.find((s) => s.classe === 'IMOBILIZACOES')).toMatchObject({ guias: 4 });
  });

  // Achado 2026-09-03 (migration 0059): médico VH com Imobilizações tem a produção mensal
  // dividida em VÁRIOS sub-lotes de Imobilizações (um por dia/período), não só um — todos devem
  // ser somados na mesma classe, mesmo mecanismo já usado para Cateter/Fístula/Angiografia
  // (migration 0046).
  it('Achado 2026-09-03 — médico VH com VÁRIOS sub-lotes de Imobilizações no mês: soma todos', async () => {
    const medico = medicoFake({
      id: 'm-imob-varios-lotes',
      cpf: '22233344466',
      nome: 'Dr. Vários Sub-lotes Imobilizações',
      fazImobilizacoes: true,
      especialidade: 'Ortopedia',
    });
    const state = novoEstado([medico]);

    state.itensPorProducao['p-agosto-completa'] = Array.from({ length: 3 }, (_, i) => ({
      data: '2026-08-01', pacienteNome: `G${i}`, atendimentoExternoId: null,
      codigoProcedimento: '30715040', descricaoProcedimento: 'Visita hospitalar',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));
    state.itensPorLote['lote-imob-05'] = Array.from({ length: 2 }, (_, i) => ({
      data: '2026-08-05', pacienteNome: `Imob-05-${i}`, atendimentoExternoId: null,
      codigoProcedimento: '31309054', descricaoProcedimento: 'Imobilização',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));
    state.itensPorLote['lote-imob-11-12'] = Array.from({ length: 3 }, (_, i) => ({
      data: '2026-08-11', pacienteNome: `Imob-11-${i}`, atendimentoExternoId: null,
      codigoProcedimento: '31309054', descricaoProcedimento: 'Imobilização',
      statusOrigem: 'Devidamente Pago', viaAcesso: false, tipoAto: 'Eletivo',
      valorCobradoOrigem: 100, valorPagoOrigem: 100,
    }));

    const selecoes = [
      {
        medicoId: 'm-imob-varios-lotes',
        producaoExternaId: 'p-agosto-completa',
        producaoNome: 'Agosto - 2026',
        producaoImobilizacoesLoteExternaIds: ['lote-imob-05', 'lote-imob-11-12'],
        producaoImobilizacoesLoteNomes: ['IMOBILIZAÇÕES - 05/08', 'IMOBILIZAÇÕES 11/08 AO 12/08'],
      },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-08', selecoes, 'u', deps);
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultados.get(exec.id)!.map((x) => x.r)[0]!;
    expect(resultado.subtotais.find((s) => s.classe === 'HAPVIDA_CRED')).toMatchObject({ guias: 3 });
    // Imobilizações = soma dos DOIS sub-lotes (2 + 3 = 5), nunca só o primeiro selecionado.
    expect(resultado.subtotais.find((s) => s.classe === 'IMOBILIZACOES')).toMatchObject({ guias: 5 });
  });
});

describe('Integração — execução agregada por empresa (Story 10.4b)', () => {
  function guiasCardiacas(n: number, prefixo: string): ItemProducao[] {
    return Array.from({ length: n }, (_, i) => ({
      data: '2026-06-01',
      pacienteNome: `${prefixo}-${i}`,
      atendimentoExternoId: null,
      codigoProcedimento: '30715040',
      descricaoProcedimento: 'Guia cardíaca',
      statusOrigem: 'Devidamente Pago',
      viaAcesso: false,
      tipoAto: 'Eletivo',
      valorCobradoOrigem: 100,
      valorPagoOrigem: 100,
    }));
  }

  it('3 médicos + empresa MEDISA (por_guia R$6,41): 1 resultado agregado + 3 contribuições, fim a fim', async () => {
    const empresa = empresaFake({
      id: 'emp-1',
      nome: 'MEDISA',
      regraPreco: { forma: 'por_guia', base: null, limiar: null, taxa: 6.41, valorFixo: null },
    });
    const medicos = [
      medicoFake({ id: 'm1', cpf: '11111111111', nome: 'Dr. 1', empresaGrupoId: 'emp-1' }),
      medicoFake({ id: 'm2', cpf: '22222222222', nome: 'Dr. 2', empresaGrupoId: 'emp-1' }),
      medicoFake({ id: 'm3', cpf: '33333333333', nome: 'Dr. 3', empresaGrupoId: 'emp-1' }),
    ];
    const state = novoEstado(medicos, [empresa]);
    state.itensPorProducao['p1'] = guiasCardiacas(150, 'm1');
    state.itensPorProducao['p2'] = guiasCardiacas(150, 'm2');
    state.itensPorProducao['p3'] = guiasCardiacas(161, 'm3');

    const selecoes = [
      { medicoId: 'm1', producaoExternaId: 'p1', producaoNome: 'Guias Cardíacas Junho' },
      { medicoId: 'm2', producaoExternaId: 'p2', producaoNome: 'Guias Cardíacas Junho' },
      { medicoId: 'm3', producaoExternaId: 'p3', producaoNome: 'Guias Cardíacas Junho' },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps, 'emp-1');
    expect(exec.empresaId).toBe('emp-1');

    await processarProximoLote(exec.id, deps);

    const final = state.execucoes.get(exec.id)!;
    expect(final.status).toBe('concluido');
    expect(final.progresso).toBe(100);
    expect(final.totalGeralValor).toBeCloseTo(2955.01, 2);
    expect(final.totalOk).toBe(1); // 1 resultado agregado, não 3

    const resultado = state.resultadosEmpresa.get(exec.id)!;
    expect(resultado.guias).toBe(461);
    expect(resultado.totalValor).toBeCloseTo(2955.01, 2);
    expect(resultado.status).toBe('ok');
    expect(resultado.nome).toBe('MEDISA');

    const contribuicoes = state.contribuicoes.get(resultado.id)!;
    expect(contribuicoes).toHaveLength(3);
    const soma = contribuicoes.reduce((acc, c) => acc + c.valor, 0);
    expect(soma).toBeCloseTo(2955.01, 2);

    // Regressão: nenhum resultado por-médico foi gravado (fluxo normal não foi tocado).
    expect(state.resultados.get(exec.id)).toEqual([]);
  });

  it('empresa com regra ausente → resultado agregado em alerta, valor 0, sem contribuições', async () => {
    const empresa = empresaFake({ id: 'emp-2', nome: 'MEDISA Sem Regra', regraPreco: null });
    const medicos = [medicoFake({ id: 'm1', cpf: '44444444444', nome: 'Dr. 1', empresaGrupoId: 'emp-2' })];
    const state = novoEstado(medicos, [empresa]);
    state.itensPorProducao['p1'] = guiasCardiacas(50, 'm1');

    const selecoes = [{ medicoId: 'm1', producaoExternaId: 'p1', producaoNome: 'Guias Cardíacas Junho' }];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    const exec = await iniciarExecucao('2026-06', selecoes, 'u', deps, 'emp-2');
    await processarProximoLote(exec.id, deps);

    const resultado = state.resultadosEmpresa.get(exec.id)!;
    expect(resultado.status).toBe('alerta');
    expect(resultado.totalValor).toBe(0);
    expect(state.contribuicoes.get(resultado.id)).toEqual([]);

    const final = state.execucoes.get(exec.id)!;
    expect(final.totalAlerta).toBe(1);
    expect(final.status).toBe('concluido'); // conclui mesmo em alerta — não é falha de infra
  });

  // QA 10.4c-1: defesa em profundidade — a UI só lista médicos vinculados à empresa, mas o
  // servidor não pode confiar só nisso (mesmo princípio do QA M-1 já existente no orquestrador).
  it('rejeita a execução se algum médico selecionado não pertence à empresa (empresaGrupoId diferente)', async () => {
    const empresa = empresaFake({
      id: 'emp-3',
      nome: 'MEDISA',
      regraPreco: { forma: 'por_guia', base: null, limiar: null, taxa: 6.41, valorFixo: null },
    });
    const medicos = [
      medicoFake({ id: 'm1', cpf: '55555555555', nome: 'Dr. Do Grupo', empresaGrupoId: 'emp-3' }),
      medicoFake({ id: 'm2', cpf: '66666666666', nome: 'Dr. Avulso', empresaGrupoId: null }),
    ];
    const state = novoEstado(medicos, [empresa]);
    state.itensPorProducao['p1'] = guiasCardiacas(10, 'm1');
    state.itensPorProducao['p2'] = guiasCardiacas(10, 'm2');

    const selecoes = [
      { medicoId: 'm1', producaoExternaId: 'p1', producaoNome: 'Guias' },
      { medicoId: 'm2', producaoExternaId: 'p2', producaoNome: 'Guias' },
    ];
    const deps = fakeDeps(state, 5, processarProximoLote, { autoEncadear: true });

    await expect(iniciarExecucao('2026-06', selecoes, 'u', deps, 'emp-3')).rejects.toMatchObject({
      code: 'SELECAO_INVALIDA',
    });
    // Nenhuma execução foi criada — falhou antes de persistir nada.
    expect(state.execucoes.size).toBe(0);
  });
});
