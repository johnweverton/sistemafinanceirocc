// Teste do recálculo de resultado (migration 0041, achado real 2026-08-04, Dr. José Neias):
// reprocessa a MESMA linha de execucao_resultados com os itens de produção ATUAIS da origem,
// sem precisar de uma execução nova. Deps injetadas em memória (mesmo espírito do
// orchestrator-unit.test.ts), sem tocar Supabase.
import { describe, it, expect, vi } from 'vitest';
import type { Execucao, ExecucaoResultado, Medico, ItemProducao, ResultadoMedico, Boleto } from '@cobranca/shared';
import {
  recalcularResultado,
  buscarItensDoResultado,
  type RecalculoDeps,
} from '../../../src/server/orchestrator/recalculo-resultado';
import type { SelecaoDeps } from '../../../src/server/orchestrator/execucao-orchestrator';

function medicoFake(over: Partial<Medico> & { id: string; nome: string }): Medico {
  return {
    cpf: '00000000000',
    especialidade: 'Pediatria',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    semExcedentePorGuia: false,
    contaEmissora: 'mc',
    colaboradorResponsavel: null,
    ativo: true,
    necessitaConfiguracao: false,
    externalId: `ext-${over.id}`,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function resultadoFake(over: Partial<ExecucaoResultado> & { id: string; execucaoId: string }): ExecucaoResultado {
  return {
    medicoId: 'med-1',
    cpf: '00000000000',
    nome: 'Dr. Teste',
    procedimentos: 38,
    cirurgias: 38,
    guias: 38,
    guiasConsolidado: 17,
    subtotais: [],
    totalValor: 465.07,
    status: 'alerta',
    alertas: ['2 procedimento(s) sem código ou descrição na origem.'],
    ...over,
  };
}

function execucaoFake(over: Partial<Execucao> & { id: string; competencia: string }): Execucao {
  return {
    iniciadoPor: 'user-1',
    iniciadoEm: '2026-07-01T00:00:00Z',
    finalizadoEm: '2026-07-01T00:05:00Z',
    status: 'concluido',
    progresso: 100,
    totalMedicos: 1,
    totalOk: 0,
    totalAlerta: 1,
    totalSemDados: 0,
    totalAcumulado: 0,
    totalGeralValor: 465.07,
    ...over,
  };
}

function selecaoFake(over: Partial<SelecaoDeps> & { execucaoId: string; medicoId: string }): SelecaoDeps {
  return {
    producaoExternaId: 'prod-2895',
    producaoNome: 'JULHO 2026',
    ...over,
  };
}

/** Monta um deps completo com defaults sensatos; cada teste sobrescreve só o que precisa. */
function baseDeps(over: Partial<RecalculoDeps> = {}): RecalculoDeps {
  return {
    buscarResultado: vi.fn(async () => resultadoFake({ id: 'res-1', execucaoId: 'exec-1' })),
    buscarExecucao: vi.fn(async () => execucaoFake({ id: 'exec-1', competencia: '2026-07' })),
    listarSelecoes: vi.fn(async () => [selecaoFake({ execucaoId: 'exec-1', medicoId: 'med-1' })]),
    buscarMedico: vi.fn(async () => medicoFake({ id: 'med-1', nome: 'JOSE NEIAS ARAUJO RIBEIRO' })),
    buscarItens: vi.fn(async () => [] as ItemProducao[]),
    buscarItensPorLote: vi.fn(async () => [] as ItemProducao[]),
    guiasExecucaoAnterior: vi.fn(async () => null),
    lerValorConsultaPediatria: vi.fn(async () => 3),
    buscarBoletoEmitido: vi.fn(async () => null),
    atualizarResultado: vi.fn(async (id: string, r: ResultadoMedico) =>
      resultadoFake({ id, execucaoId: 'exec-1', ...r, medicoId: 'med-1' }),
    ),
    buscarSaldoAcumulado: vi.fn(async () => null),
    ...over,
  };
}

const itemViaAcesso = (paciente: string, senha: string): ItemProducao => ({
  data: '2026-07-06',
  pacienteNome: paciente,
  atendimentoExternoId: senha,
  codigoProcedimento: '10101012',
  descricaoProcedimento: 'Cirurgia',
  statusOrigem: 'Devidamente Pago',
  viaAcesso: true,
  tipoAto: 'Eletivo',
  valorCobradoOrigem: 100,
  valorPagoOrigem: 100,
});

describe('recalcularResultado', () => {
  it('reprocessa o resultado com os itens ATUAIS e grava o novo cálculo (réplica José Neias: 38 → 19 guias)', async () => {
    // 15 pacientes com 1 item + 2 pacientes com 4 itens (via de acesso, senha própria por
    // procedimento) — 19 guias corretas para pediatra 3x1, não 38.
    const itens: ItemProducao[] = [];
    let seq = 0;
    for (let i = 0; i < 15; i++) itens.push(itemViaAcesso(`Paciente ${i}`, `s${seq++}`));
    for (const paciente of ['Edriana', 'Francisco']) {
      for (let i = 0; i < 4; i++) itens.push(itemViaAcesso(paciente, `s${seq++}`));
    }

    const deps = baseDeps({ buscarItens: vi.fn(async () => itens) });

    const resultado = await recalcularResultado('res-1', 'user-financeiro', deps);

    expect(resultado.guias).toBe(19);
    expect(resultado.status).toBe('ok');
    expect(deps.atualizarResultado).toHaveBeenCalledWith(
      'res-1',
      expect.objectContaining({ guias: 19 }),
      'user-financeiro',
    );
  });

  it('bloqueia o recálculo se já existir boleto ativo para o resultado', async () => {
    const deps = baseDeps({ buscarBoletoEmitido: vi.fn(async () => ({ id: 'bol-1' }) as unknown as Boleto) });

    await expect(recalcularResultado('res-1', 'user-financeiro', deps)).rejects.toMatchObject({
      code: 'BOLETO_JA_EMITIDO',
    });
    expect(deps.atualizarResultado).not.toHaveBeenCalled();
  });

  it('rejeita resultado de empresa/cliente contábil (sem medicoId) — recálculo só existe para médico', async () => {
    const deps = baseDeps({
      buscarResultado: vi.fn(async () => resultadoFake({ id: 'res-1', execucaoId: 'exec-1', medicoId: null })),
    });

    await expect(recalcularResultado('res-1', 'user-financeiro', deps)).rejects.toMatchObject({
      code: 'RECALCULO_NAO_SUPORTADO',
    });
  });

  it('resultado inexistente → 404 RESULTADO_NAO_ENCONTRADO', async () => {
    const deps = baseDeps({ buscarResultado: vi.fn(async () => null) });
    await expect(recalcularResultado('res-inexistente', 'user-financeiro', deps)).rejects.toMatchObject({
      code: 'RESULTADO_NAO_ENCONTRADO',
    });
  });

  it('sem seleção de produção do médico nesta execução → 404 SELECAO_NAO_ENCONTRADA', async () => {
    const deps = baseDeps({ listarSelecoes: vi.fn(async () => []) });
    await expect(recalcularResultado('res-1', 'user-financeiro', deps)).rejects.toMatchObject({
      code: 'SELECAO_NAO_ENCONTRADA',
    });
  });

  // Achado 2026-09-02 (auditoria da contagem 3x1): o recálculo lia só `producaoExternaId`/
  // `producaoConsultasExternaId` e ignorava os sub-lotes que o orquestrador principal já tratava
  // desde 2026-08-21 — um pediatra com sub-lote de consulta (producaoExternaId NULL) recalculava
  // com zero itens e zerava o resultado. Espelho do caso "Humberto" de execucao-integracao.test.ts.
  it('pediatra com sub-lotes de guia/consulta (producaoExternaId null) recalcula pelos sub-lotes, não zera', async () => {
    const itemDeLote = (paciente: string): ItemProducao => ({
      data: '2026-07-05',
      pacienteNome: paciente,
      atendimentoExternoId: null,
      codigoProcedimento: '30715040',
      descricaoProcedimento: 'Visita hospitalar',
      statusOrigem: 'Devidamente Pago',
      viaAcesso: false,
      tipoAto: 'Eletivo',
      valorCobradoOrigem: 100,
      valorPagoOrigem: 100,
    });
    const itensPorLote: Record<string, ItemProducao[]> = {
      'lote-1q': Array.from({ length: 3 }, (_, i) => itemDeLote(`1Q-${i}`)),
      'lote-2q': Array.from({ length: 2 }, (_, i) => itemDeLote(`2Q-${i}`)),
      'lote-consultas': Array.from({ length: 10 }, (_, i) => itemDeLote(`Consulta ${i}`)),
    };

    const deps = baseDeps({
      listarSelecoes: vi.fn(async () => [
        selecaoFake({
          execucaoId: 'exec-1',
          medicoId: 'med-1',
          producaoExternaId: null,
          producaoNome: null,
          producaoGuiasLoteExternaIds: ['lote-1q', 'lote-2q'],
          producaoConsultasLoteExternaIds: ['lote-consultas'],
        }),
      ]),
      buscarItensPorLote: vi.fn(async (loteId: string) => itensPorLote[loteId] ?? []),
    });

    const resultado = await recalcularResultado('res-1', 'user-financeiro', deps);

    // 3 (1Q) + 2 (2Q) = 5 guias — antes do fix dava 0 (nenhum lote era buscado).
    expect(resultado.guias).toBe(5);
    expect(resultado.status).not.toBe('sem_dados');
    // 10 consultas × R$3,00 (lerValorConsultaPediatria fake) = R$30,00.
    expect(resultado.subtotais?.find((s) => s.classe === 'CONSULTA_PEDIATRIA')).toMatchObject({
      guias: 10,
      valor: 30,
    });
    // Nunca cai na produção flat quando os sub-lotes vieram preenchidos (anti-dupla-contagem).
    expect(deps.buscarItens).not.toHaveBeenCalled();
  });

  // Migration 0058 (contagem manual por planilha) — MESMA classe de bug do achado A1 acima: um
  // campo que o orquestrador principal passa e o recálculo esquece. Aqui a falha seria ainda pior
  // que zerar: o recálculo voltaria silenciosamente para a contagem AUTOMÁTICA que o dono já sabe
  // estar errada para este médico, mudando o valor cobrado sem ninguém pedir.
  it('preserva a contagem manual gravada na seleção (não volta para a contagem automática)', async () => {
    const itens = Array.from({ length: 15 }, (_, i) => itemViaAcesso(`Paciente ${i}`, `s${i}`));
    const deps = baseDeps({
      buscarItens: vi.fn(async () => itens),
      listarSelecoes: vi.fn(async () => [
        selecaoFake({
          execucaoId: 'exec-1',
          medicoId: 'med-1',
          guiasManuaisTotal: 42,
          guiasManuaisMotivo: 'Conferencia manual do dono',
        }),
      ]),
    });

    const resultado = await recalcularResultado('res-1', 'user-financeiro', deps);

    // 15 itens dariam 15 guias na contagem automática — o número conferido à mão prevalece.
    expect(resultado.guias).toBe(42);
    expect(resultado.alertas[0]).toContain('CONTAGEM MANUAL (planilha): 42 guia(s)');
    expect(resultado.alertas[0]).toContain('Conferencia manual do dono');
    // Recalcular não pode "rebaixar" o resultado: a marca de contagem manual é auditoria, e o
    // status segue 'ok' (GATE do dono 2026-09-03) — senão o recálculo bloquearia a emissão.
    expect(resultado.status).toBe('ok');
  });

  it('seleção sem contagem manual continua recalculando pela produção (regressão)', async () => {
    const itens = Array.from({ length: 15 }, (_, i) => itemViaAcesso(`Paciente ${i}`, `s${i}`));
    const deps = baseDeps({ buscarItens: vi.fn(async () => itens) });

    const resultado = await recalcularResultado('res-1', 'user-financeiro', deps);

    expect(resultado.guias).toBe(15);
    expect(resultado.alertas.some((a) => a.includes('CONTAGEM MANUAL'))).toBe(false);
  });
});

// Achado 2026-09-04 (auditoria 3x1): `buscarItensDoResultado` foi extraída de
// `recalcularResultado` pra ser reaproveitada pela rota de auditoria — busca os mesmos buckets,
// mas NUNCA roda `processarMedico`/`atualizarResultado` (a auditoria não pode, por engano,
// recalcular/gravar o resultado).
describe('buscarItensDoResultado', () => {
  it('médico normal (produção flat): devolve o lote principal em `lotePrincipal`, sem tocar em `processarMedico`/`atualizarResultado`', async () => {
    const itens = Array.from({ length: 5 }, (_, i) => itemViaAcesso(`Paciente ${i}`, `s${i}`));
    const deps = baseDeps({ buscarItens: vi.fn(async () => itens) });

    const dados = await buscarItensDoResultado('res-1', deps);

    expect(dados.medico.id).toBe('med-1');
    expect(dados.execucao.id).toBe('exec-1');
    expect(dados.lotePrincipal).toEqual(itens);
    expect(dados.outrosHospitais).toBeUndefined();
    expect(dados.saldoAcumulado).toBeNull();
    expect(deps.atualizarResultado).not.toHaveBeenCalled();
  });

  it('pediatra com sub-lotes de guia/consulta (producaoExternaId null): busca pelos sub-lotes, não pela produção flat', async () => {
    const itemDeLote = (paciente: string): ItemProducao => ({
      data: '2026-07-05',
      pacienteNome: paciente,
      atendimentoExternoId: null,
      codigoProcedimento: '30715040',
      descricaoProcedimento: 'Visita hospitalar',
      statusOrigem: 'Devidamente Pago',
      viaAcesso: false,
      tipoAto: 'Eletivo',
      valorCobradoOrigem: 100,
      valorPagoOrigem: 100,
    });
    const itensPorLote: Record<string, ItemProducao[]> = {
      'lote-1q': Array.from({ length: 3 }, (_, i) => itemDeLote(`1Q-${i}`)),
      'lote-consultas': Array.from({ length: 10 }, (_, i) => itemDeLote(`Consulta ${i}`)),
    };
    const deps = baseDeps({
      listarSelecoes: vi.fn(async () => [
        selecaoFake({
          execucaoId: 'exec-1',
          medicoId: 'med-1',
          producaoExternaId: null,
          producaoNome: null,
          producaoGuiasLoteExternaIds: ['lote-1q'],
          producaoConsultasLoteExternaIds: ['lote-consultas'],
        }),
      ]),
      buscarItensPorLote: vi.fn(async (loteId: string) => itensPorLote[loteId] ?? []),
    });

    const dados = await buscarItensDoResultado('res-1', deps);

    expect(dados.lotePrincipal).toHaveLength(3);
    expect(dados.itensConsultas).toHaveLength(10);
    expect(deps.buscarItens).not.toHaveBeenCalled();
    expect(deps.atualizarResultado).not.toHaveBeenCalled();
  });

  it('Angiologista (sem lote principal): devolve os 4 lotes próprios (Cateter/Fístula/Angiografia) e Carta de Rede', async () => {
    const item = (paciente: string): ItemProducao => ({
      data: '2026-07-05',
      pacienteNome: paciente,
      atendimentoExternoId: null,
      codigoProcedimento: '10101012',
      descricaoProcedimento: 'Procedimento',
      statusOrigem: 'Devidamente Pago',
      viaAcesso: false,
      tipoAto: 'Eletivo',
      valorCobradoOrigem: 100,
      valorPagoOrigem: 100,
    });
    const itensPorLote: Record<string, ItemProducao[]> = {
      'lote-cateter': [item('P1'), item('P2')],
      'lote-fistula': [item('P3')],
      'lote-angio': [item('P4'), item('P5'), item('P6')],
    };
    const deps = baseDeps({
      buscarMedico: vi.fn(async () => medicoFake({ id: 'med-1', nome: 'Dr. Angio', especialidade: 'Angiologista' })),
      listarSelecoes: vi.fn(async () => [
        selecaoFake({
          execucaoId: 'exec-1',
          medicoId: 'med-1',
          producaoExternaId: null,
          producaoNome: null,
          producaoCateterExternaIds: ['lote-cateter'],
          producaoFistulaExternaIds: ['lote-fistula'],
          producaoAngiografiaExternaIds: ['lote-angio'],
          cartaRedeGuias: 4,
        }),
      ]),
      buscarItensPorLote: vi.fn(async (loteId: string) => itensPorLote[loteId] ?? []),
    });

    const dados = await buscarItensDoResultado('res-1', deps);

    expect(dados.cateter).toHaveLength(2);
    expect(dados.fistula).toHaveLength(1);
    expect(dados.angiografia).toHaveLength(3);
    expect(dados.guiasCartaRede).toBe(4);
    expect(dados.lotePrincipal).toEqual([]); // Angiologista não tem lote principal
    expect(deps.atualizarResultado).not.toHaveBeenCalled();
  });

  it('busca `saldoAcumulado` do médico (usado pelo resumo da auditoria 3x1, nunca por `recalcularResultado`)', async () => {
    const deps = baseDeps({
      buscarSaldoAcumulado: vi.fn(async () => ({
        guiasPrincipal: 5,
        guiasOutrosHospitais: 0,
        guiasImobilizacoes: 0,
        valorBasePercentual: 0,
        competenciaOrigem: '2026-06',
      })),
    });

    const dados = await buscarItensDoResultado('res-1', deps);

    expect(dados.saldoAcumulado).toMatchObject({ guiasPrincipal: 5, competenciaOrigem: '2026-06' });
  });
});
