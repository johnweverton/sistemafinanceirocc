// Achado real 2026-08-27: duas leituras seguidas da API do sistema web pra MESMA produção
// (mesma seleção, sem concorrência, mesma competência) devolveram itens diferentes — o motor
// contou 70 guias numa e 157 na outra pro mesmo médico (Dr. Pedro Barreira Cabral, pediatra).
// Investigação descartou mudança real de dado na origem, concorrência e seleção diferente —
// sobrou instabilidade da própria API entre chamadas.
//
// Feedback do dono (2026-08-27) sobre a 1ª versão desta blindagem (2 leituras, desiste na 1ª
// divergência): "eu quero que a contagem venha corretamente e não que gere alerta". Reescrita
// pra RELER até achar 2 leituras CONSECUTIVAS iguais (até `MAX_TENTATIVAS_ESTABILIZACAO`) — só
// gera alerta se a origem continuar mudando a cada leitura até esgotar as tentativas. Caminho
// comum (já bate na 2ª leitura) continua custando exatamente 2 chamadas, como antes.
import { describe, it, expect } from 'vitest';
import type { ItemProducao } from '@cobranca/shared';
import { iniciarExecucao, processarProximoLote } from '../../../src/server/orchestrator/execucao-orchestrator';
import { novoEstado, medicoFake, fakeDeps } from './fake-deps';

function item(over: Partial<ItemProducao> & { pacienteNome: string; data: string }): ItemProducao {
  return {
    atendimentoExternoId: null,
    codigoProcedimento: '31309054',
    descricaoProcedimento: 'Procedimento teste',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
    ...over,
  };
}

/** 6 itens de 2 pacientes — combinação de datas que muda o resultado do teto(n/3) conforme como
 *  a data de cada item vem (mesmo padrão do caso real). Cada variante abaixo é pairwise diferente
 *  da vizinha, pra simular a origem "mudando de resposta" a cada leitura. */
function variante(paciente1Datas: [string, string, string]): ItemProducao[] {
  return [
    item({ pacienteNome: 'Paciente 1', data: paciente1Datas[0] }),
    item({ pacienteNome: 'Paciente 1', data: paciente1Datas[1] }),
    item({ pacienteNome: 'Paciente 1', data: paciente1Datas[2] }),
    item({ pacienteNome: 'Paciente 2', data: '2026-07-10' }),
    item({ pacienteNome: 'Paciente 2', data: '2026-07-10' }),
    item({ pacienteNome: 'Paciente 2', data: '2026-07-10' }),
  ];
}

const varianteA = () => variante(['2026-07-05', '2026-07-05', '2026-07-05']); // 1 guia (mesmo dia)
const varianteB = () => variante(['2026-07-05', '2026-07-06', '2026-07-07']); // 3 guias (fragmentado)
const varianteC = () => variante(['2026-07-05', '2026-07-05', '2026-07-06']); // 2 guias
const varianteD = () => variante(['2026-07-06', '2026-07-06', '2026-07-06']); // 1 guia (dia diferente de A)

describe('Orchestrator — estabilização de instabilidade da origem (especialidades 3x1)', () => {
  it('pediatra: leitura 1 diverge da 2, mas a 3 repete a 2 → estabiliza, usa esse valor, SEM alerta', async () => {
    const medico = medicoFake({ id: 'm-ped', cpf: '11111111111', nome: 'Dr. Pediatra', especialidade: 'Pediatra' });
    const state = novoEstado([medico]);
    const selecoes = [{ medicoId: 'm-ped', producaoExternaId: 'p-oscila', producaoNome: 'JULHO 2026' }];
    const deps = fakeDeps(state, 10, processarProximoLote, { autoEncadear: true });

    const respostas = [varianteA, varianteB, varianteB]; // 1ª ≠ 2ª, mas 3ª repete a 2ª → estabiliza
    let chamadas = 0;
    const original = deps.buscarItens;
    deps.buscarItens = async (id: string) => {
      if (id !== 'p-oscila') return original(id);
      const r = respostas[chamadas]!();
      chamadas += 1;
      return r;
    };

    const exec = await iniciarExecucao('2026-07', selecoes, 'colaborador-1', deps);
    await processarProximoLote(exec.id, deps);

    expect(chamadas).toBe(3); // 1ª (A) + 2ª (B, diverge) + 3ª (B, repete a 2ª → estabiliza)
    const resultados = state.resultados.get(exec.id)!.map((x) => x.r);
    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.status).not.toBe('alerta');
    // varianteB fragmenta Paciente 1 em 3 dias → 3 guias dele + 1 guia do Paciente 2 = 4;
    // abaixo do limiar mínimo (5) → 'acumulado', não 'ok', mas o ponto do teste é: NÃO É 'alerta'
    // e o valor usado foi o que estabilizou (B), não um número arbitrário.
    expect(resultados[0]!.status).toBe('acumulado');
    expect(resultados[0]!.guias).toBe(4);
  });

  it('pediatra: origem NUNCA estabiliza dentro do limite de tentativas → alerta, nunca chuta a contagem', async () => {
    const medico = medicoFake({ id: 'm-ped2', cpf: '22222222222', nome: 'Dr. Pediatra Caótico', especialidade: 'Pediatra' });
    const state = novoEstado([medico]);
    const selecoes = [{ medicoId: 'm-ped2', producaoExternaId: 'p-instavel', producaoNome: 'JULHO 2026' }];
    const deps = fakeDeps(state, 10, processarProximoLote, { autoEncadear: true });

    // A→B→C→D: cada leitura diferente da anterior, nunca 2 seguidas iguais.
    const respostas = [varianteA, varianteB, varianteC, varianteD];
    let chamadas = 0;
    const original = deps.buscarItens;
    deps.buscarItens = async (id: string) => {
      if (id !== 'p-instavel') return original(id);
      const r = respostas[chamadas]!();
      chamadas += 1;
      return r;
    };

    const exec = await iniciarExecucao('2026-07', selecoes, 'colaborador-1', deps);
    await processarProximoLote(exec.id, deps);

    expect(chamadas).toBe(4); // esgotou MAX_TENTATIVAS_ESTABILIZACAO sem 2 leituras iguais
    const resultados = state.resultados.get(exec.id)!.map((x) => x.r);
    expect(resultados[0]!.status).toBe('alerta');
    expect(resultados[0]!.guias).toBe(0);
    expect(resultados[0]!.subtotais).toEqual([]);
    expect(resultados[0]!.alertas.some((a) => a.includes('não estabilizou'))).toBe(true);
  }, 10_000);

  it('pediatra: 2 leituras IDÊNTICAS de cara → processa normalmente, só 2 chamadas (caminho comum)', async () => {
    const medico = medicoFake({ id: 'm-ped3', cpf: '55555555555', nome: 'Dr. Pediatra Estável', especialidade: 'Pediatra' });
    const state = novoEstado([medico]);
    const selecoes = [{ medicoId: 'm-ped3', producaoExternaId: 'p-estavel', producaoNome: 'JULHO 2026' }];
    state.itensPorProducao['p-estavel'] = varianteA();
    const deps = fakeDeps(state, 10, processarProximoLote, { autoEncadear: true });

    let chamadas = 0;
    const original = deps.buscarItens;
    deps.buscarItens = async (id: string) => {
      if (id === 'p-estavel') chamadas += 1;
      return original(id);
    };

    const exec = await iniciarExecucao('2026-07', selecoes, 'colaborador-1', deps);
    await processarProximoLote(exec.id, deps);

    expect(chamadas).toBe(2); // caminho comum: bate de cara, sem pausa/releitura extra
    const resultados = state.resultados.get(exec.id)!.map((x) => x.r);
    expect(resultados[0]!.status).not.toBe('alerta');
  });

  it('BUG REAL encontrado em auto-revisão (2026-08-27): status administrativo mudando entre leituras (ex.: glosa processada) NÃO pode gerar falso positivo', async () => {
    const medico = medicoFake({ id: 'm-ped4', cpf: '44444444444', nome: 'Dr. Pediatra Status', especialidade: 'Pediatra' });
    const state = novoEstado([medico]);
    const selecoes = [{ medicoId: 'm-ped4', producaoExternaId: 'p-status', producaoNome: 'JULHO 2026' }];
    const deps = fakeDeps(state, 10, processarProximoLote, { autoEncadear: true });

    let chamadas = 0;
    const original = deps.buscarItens;
    deps.buscarItens = async (id: string) => {
      if (id !== 'p-status') return original(id);
      chamadas += 1;
      const base = varianteA();
      // Mesmos itens (mesma data/paciente/procedimento) — só o status mudou entre as duas
      // leituras, como aconteceria se uma glosa fosse processada nesse intervalo. `statusOrigem`
      // NUNCA filtra contagem (ver toItemProducao) — não pode disparar o alerta de instabilidade.
      return chamadas === 1 ? base : base.map((i) => ({ ...i, statusOrigem: 'Glosado' }));
    };

    const exec = await iniciarExecucao('2026-07', selecoes, 'colaborador-1', deps);
    await processarProximoLote(exec.id, deps);

    expect(chamadas).toBe(2); // bate de cara (status não entra na assinatura), sem releitura extra
    const resultados = state.resultados.get(exec.id)!.map((x) => x.r);
    expect(resultados[0]!.status).not.toBe('alerta');
  });

  it('especialidade SEM regra 3x1: busca só 1 vez, mesmo com dados que mudariam entre chamadas', async () => {
    const medico = medicoFake({ id: 'm-clin', cpf: '33333333333', nome: 'Dr. Clínico', especialidade: 'Clínico Geral' });
    const state = novoEstado([medico]);
    const selecoes = [{ medicoId: 'm-clin', producaoExternaId: 'p-clin', producaoNome: 'JULHO 2026' }];
    const deps = fakeDeps(state, 10, processarProximoLote, { autoEncadear: true });

    const respostas = [varianteA, varianteB];
    let chamadas = 0;
    const original = deps.buscarItens;
    deps.buscarItens = async (id: string) => {
      if (id !== 'p-clin') return original(id);
      const r = respostas[chamadas]!();
      chamadas += 1;
      return r;
    };

    const exec = await iniciarExecucao('2026-07', selecoes, 'colaborador-1', deps);
    await processarProximoLote(exec.id, deps);

    expect(chamadas).toBe(1); // sem 3x1, não paga o custo de nenhuma releitura
    const resultados = state.resultados.get(exec.id)!.map((x) => x.r);
    expect(resultados[0]!.status).not.toBe('alerta');
  });
});
