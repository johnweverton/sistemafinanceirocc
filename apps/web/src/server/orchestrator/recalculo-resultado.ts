// Recálculo de um resultado já gravado (migration 0041, achado real 2026-08-04, Dr. José
// Neias): quando o dado de origem é corrigido DEPOIS que a execução já rodou, reprocessa a
// MESMA linha de execucao_resultados em vez de exigir uma execução inteira nova. Reaproveita o
// mesmo Engine puro (`processarMedico`) que o orquestrador principal usa — só muda de onde vêm
// os dados de entrada (a seleção já gravada da execução original, não uma nova seleção do
// operador). Dependências injetáveis pelo mesmo motivo do orchestrator principal: testar sem
// tocar Supabase nem a API da Carmem.
import type { ExecucaoResultado, Execucao, Medico, ItemProducao, ResultadoMedico, Boleto } from '@cobranca/shared';
import { processarMedico } from '@/server/engine';
import { buscarItens, buscarItensPorLote } from '@/server/integration/fin-api-client';
import { buscarMedico } from '@/server/repositories/medico-repository';
import {
  buscarResultadoPorId,
  buscarExecucao,
  listarSelecoes,
  guiasExecucaoAnterior,
  atualizarResultado,
} from '@/server/repositories/execucao-repository';
import { buscarBoletoEmitido } from '@/server/repositories/boleto-repository';
import { lerValorConsultaPediatria } from '@/server/repositories/config-cobranca-repository';
import { ApiError } from '@/lib/api-error';
import { buscarItensDeVariosLotes, type SelecaoDeps } from './execucao-orchestrator';

export interface RecalculoDeps {
  buscarResultado: (id: string) => Promise<ExecucaoResultado | null>;
  buscarExecucao: (id: string) => Promise<Execucao | null>;
  listarSelecoes: (execucaoId: string) => Promise<SelecaoDeps[]>;
  buscarMedico: (id: string) => Promise<Medico | null>;
  buscarItens: (producaoExternaId: string) => Promise<ItemProducao[]>;
  /** Sub-lotes do Angiologista (Cateter/Fístula/Angiografia) — busca via `loteId`, não `producaoId`
   * (devolutiva do desenvolvedor, GATE 2026-08-13). */
  buscarItensPorLote: (loteExternoId: string) => Promise<ItemProducao[]>;
  guiasExecucaoAnterior: (medicoId: string, competenciaAtual: string) => Promise<number | null>;
  lerValorConsultaPediatria: () => Promise<number>;
  buscarBoletoEmitido: (resultadoId: string) => Promise<Boleto | null>;
  atualizarResultado: (resultadoId: string, r: ResultadoMedico, recalculadoPor: string) => Promise<ExecucaoResultado>;
}

export function depsPadrao(): RecalculoDeps {
  return {
    buscarResultado: buscarResultadoPorId,
    buscarExecucao,
    listarSelecoes,
    buscarMedico,
    buscarItens,
    buscarItensPorLote,
    guiasExecucaoAnterior,
    lerValorConsultaPediatria,
    buscarBoletoEmitido,
    atualizarResultado,
  };
}

/**
 * Recalcula um resultado de MÉDICO (não empresa/cliente contábil — esses não têm produção
 * individual para reprocessar). Bloqueado se já existir boleto ativo (emitido/pago) para o
 * resultado: recalcular por baixo de um boleto já emitido deixaria o valor cobrado e o valor
 * gravado divergentes silenciosamente — o operador precisa cancelar o boleto antes.
 */
export async function recalcularResultado(
  resultadoId: string,
  usuarioId: string,
  deps: RecalculoDeps = depsPadrao(),
): Promise<ExecucaoResultado> {
  const resultado = await deps.buscarResultado(resultadoId);
  if (!resultado) throw new ApiError(404, 'Resultado de execução não encontrado', 'RESULTADO_NAO_ENCONTRADO');
  if (!resultado.medicoId) {
    throw new ApiError(
      422,
      'Recálculo só é suportado para resultados de médico (não empresa/cliente contábil)',
      'RECALCULO_NAO_SUPORTADO',
    );
  }
  // Achado 2026-08-13: resultado 'acumulado' nunca foi cobrado (produção retida abaixo do
  // limiar mínimo de guias) — recalcular não faz sentido aqui, o ciclo de acumulação já roda
  // sozinho a cada nova execução do médico. Bloqueia explicitamente em vez de deixar o Engine
  // reprocessar sem saldo (perderia o vínculo com `medicos_saldo_acumulado`).
  if (resultado.status === 'acumulado') {
    throw new ApiError(
      422,
      'Resultado com produção acumulada (abaixo do mínimo de guias) não pode ser recalculado — rode uma nova execução deste médico na competência seguinte.',
      'RECALCULO_NAO_SUPORTADO',
    );
  }

  const boletoAtivo = await deps.buscarBoletoEmitido(resultadoId);
  if (boletoAtivo) {
    throw new ApiError(
      409,
      'Este resultado já tem boleto emitido — cancele o boleto antes de recalcular.',
      'BOLETO_JA_EMITIDO',
    );
  }

  const execucao = await deps.buscarExecucao(resultado.execucaoId);
  if (!execucao) throw new ApiError(404, 'Execução não encontrada', 'EXECUCAO_NAO_ENCONTRADA');

  const selecoes = await deps.listarSelecoes(resultado.execucaoId);
  const selecao = selecoes.find((s) => s.medicoId === resultado.medicoId);
  if (!selecao) {
    throw new ApiError(404, 'Seleção de produção do médico não encontrada nesta execução', 'SELECAO_NAO_ENCONTRADA');
  }

  const medico = await deps.buscarMedico(resultado.medicoId);
  if (!medico) throw new ApiError(404, 'Médico não encontrado', 'MEDICO_NAO_ENCONTRADO');

  // Achado 2026-09-02: o recálculo ignorava os sub-lotes (`producaoGuiasLoteExternaIds`/
  // `producaoConsultasLoteExternaIds`) que o orquestrador principal já tratava desde o achado
  // 2026-08-21 — um pediatra com sub-lote de consulta (producaoExternaId null, produção 100% nos
  // sub-lotes) recalculava com ZERO itens e zerava o resultado. Mesma lógica de
  // `processarUmMedico` (execucao-orchestrator.ts): sub-lote vence a produção flat.
  const itensDeGuiasPorLote = await buscarItensDeVariosLotes(deps, selecao.producaoGuiasLoteExternaIds);
  // Angiologista não tem lote principal (GATE 2026-08-07) — producaoExternaId fica null pra
  // ele, `itens` fica vazio (o Engine desvia pro caminho de Cateter/Fístula/Angiografia).
  const itens =
    itensDeGuiasPorLote ?? (selecao.producaoExternaId ? await deps.buscarItens(selecao.producaoExternaId) : []);
  const itensConsultasPorLote = await buscarItensDeVariosLotes(deps, selecao.producaoConsultasLoteExternaIds);
  const itensConsultas =
    itensConsultasPorLote ??
    (selecao.producaoConsultasExternaId ? await deps.buscarItens(selecao.producaoConsultasExternaId) : undefined);
  const itensOutrosHospitais = selecao.producaoOutrosHospitaisExternaId
    ? await deps.buscarItens(selecao.producaoOutrosHospitaisExternaId)
    : undefined;
  // Sub-lote(s) de Imobilizações (achado 2026-08-25, migration 0059: virou ARRAY) têm prioridade
  // sobre a produção flat — mesmo padrão do orquestrador principal.
  const itensImobilizacoesPorLote = await buscarItensDeVariosLotes(deps, selecao.producaoImobilizacoesLoteExternaIds);
  const itensImobilizacoes =
    itensImobilizacoesPorLote ??
    (selecao.producaoImobilizacoesExternaId ? await deps.buscarItens(selecao.producaoImobilizacoesExternaId) : undefined);
  // Sub-lotes vêm de fin-lotes, não fin-producoes — busca via loteId (GATE 2026-08-13). ARRAY
  // (migration 0046): soma todas as quinzenas (1Q/2Q) selecionadas de cada categoria.
  const itensCateter = await buscarItensDeVariosLotes(deps, selecao.producaoCateterExternaIds);
  const itensFistula = await buscarItensDeVariosLotes(deps, selecao.producaoFistulaExternaIds);
  const itensAngiografia = await buscarItensDeVariosLotes(deps, selecao.producaoAngiografiaExternaIds);
  // GATE 2026-08-12: Carta de Rede não busca itens — re-lê o número já gravado na seleção.
  const guiasCartaRede = selecao.cartaRedeGuias ?? undefined;
  // Migration 0058: mesma coisa para a contagem manual por planilha — o número (e o motivo) já
  // estão na seleção gravada, é só relê-los. NÃO ESQUECER de manter em paridade com
  // `processarUmMedico` (execucao-orchestrator.ts): o achado 2026-09-02 (A1) foi exatamente um
  // campo novo que o orquestrador principal passava e o recálculo não — o resultado recalculava
  // com o dado faltando e zerava. Aqui a falha seria pior ainda: o recálculo voltaria a usar a
  // contagem AUTOMÁTICA (a que o dono já sabe estar errada pra este médico) por baixo do pano.
  const guiasManuaisTotal = selecao.guiasManuaisTotal ?? undefined;
  const guiasManuaisMotivo = selecao.guiasManuaisMotivo ?? undefined;

  const historicoGuias = await deps.guiasExecucaoAnterior(medico.id, execucao.competencia);
  const valorConsultaPediatria = await deps.lerValorConsultaPediatria();

  // `saldoAcumulado` deliberadamente OMITIDO (achado 2026-08-13): este resultado já era
  // 'ok'/'alerta' (bloqueio acima descarta 'acumulado'), ou seja, qualquer saldo que ele tenha
  // consumido da primeira vez já foi limpo de `medicos_saldo_acumulado` — não há o que reinjetar
  // aqui, e o ciclo de acumulação do médico continua rodando normalmente nas próximas execuções.
  const novoResultado = processarMedico(
    {
      medico,
      itens,
      historicoGuias,
      itensConsultas,
      itensOutrosHospitais,
      itensImobilizacoes,
      itensCateter,
      itensFistula,
      itensAngiografia,
      guiasCartaRede,
      guiasManuaisTotal,
      guiasManuaisMotivo,
      competencia: execucao.competencia,
    },
    undefined,
    valorConsultaPediatria,
  );

  return deps.atualizarResultado(resultadoId, novoResultado, usuarioId);
}
