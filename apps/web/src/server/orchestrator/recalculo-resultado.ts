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
import { buscarSaldoAcumulado, type SaldoAcumuladoPersistido } from '@/server/repositories/saldo-acumulado-repository';
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
  /** Achado 2026-09-04 (auditoria 3x1): usado por `buscarItensDoResultado` pra anotar, no resumo
   *  da planilha de auditoria, quando o valor gravado inclui saldo retido de competência anterior
   *  (nunca usado por `recalcularResultado` em si — ver comentário na função). */
  buscarSaldoAcumulado: (medicoId: string) => Promise<SaldoAcumuladoPersistido | null>;
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
    buscarSaldoAcumulado,
  };
}

/** Buckets brutos de itens de um resultado já gravado — mesmo formato que alimenta a auditoria
 *  3x1 (`BucketsItensAuditoria` em `auditoria-3x1-excel.ts`). */
export interface BucketsDeItensResultado {
  /** O resultado gravado como estava (guias/subtotais/status já cobrados) — nunca alterado por
   *  esta função. Usado pela auditoria 3x1 pra comparar o total calculado contra o valor real. */
  resultado: ExecucaoResultado;
  medico: Medico;
  execucao: Execucao;
  lotePrincipal: ItemProducao[];
  outrosHospitais?: ItemProducao[];
  imobilizacoes?: ItemProducao[];
  cateter?: ItemProducao[];
  fistula?: ItemProducao[];
  angiografia?: ItemProducao[];
  itensConsultas?: ItemProducao[];
  guiasCartaRede?: number;
  guiasManuaisTotal?: number;
  guiasManuaisMotivo?: string;
  historicoGuias: number | null;
  valorConsultaPediatria: number;
  saldoAcumulado: SaldoAcumuladoPersistido | null;
}

/**
 * Busca TODOS os buckets de itens brutos de um resultado já gravado, a partir da seleção
 * gravada da execução (`listarSelecoes`/`SelecaoDeps`) — extraído de `recalcularResultado`
 * (achado 2026-09-04, auditoria 3x1) pra ser reaproveitado pela rota de auditoria SEM rodar
 * `processarMedico` nem `atualizarResultado` (a auditoria nunca altera o resultado gravado,
 * só lê os itens da origem ATUAL pra montar a planilha de conferência).
 */
export async function buscarItensDoResultado(
  resultadoId: string,
  deps: RecalculoDeps = depsPadrao(),
): Promise<BucketsDeItensResultado> {
  const resultado = await deps.buscarResultado(resultadoId);
  if (!resultado) throw new ApiError(404, 'Resultado de execução não encontrado', 'RESULTADO_NAO_ENCONTRADO');
  if (!resultado.medicoId) {
    throw new ApiError(
      422,
      'Só é suportado para resultados de médico (não empresa/cliente contábil)',
      'RECALCULO_NAO_SUPORTADO',
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

  // Mesma lógica de `processarUmMedico` (execucao-orchestrator.ts): sub-lote vence a produção
  // flat (achado 2026-09-02).
  const itensDeGuiasPorLote = await buscarItensDeVariosLotes(deps, selecao.producaoGuiasLoteExternaIds);
  const lotePrincipal =
    itensDeGuiasPorLote ?? (selecao.producaoExternaId ? await deps.buscarItens(selecao.producaoExternaId) : []);
  const itensConsultasPorLote = await buscarItensDeVariosLotes(deps, selecao.producaoConsultasLoteExternaIds);
  const itensConsultas =
    itensConsultasPorLote ??
    (selecao.producaoConsultasExternaId ? await deps.buscarItens(selecao.producaoConsultasExternaId) : undefined);
  const outrosHospitais = selecao.producaoOutrosHospitaisExternaId
    ? await deps.buscarItens(selecao.producaoOutrosHospitaisExternaId)
    : undefined;
  const itensImobilizacoesPorLote = await buscarItensDeVariosLotes(deps, selecao.producaoImobilizacoesLoteExternaIds);
  const imobilizacoes =
    itensImobilizacoesPorLote ??
    (selecao.producaoImobilizacoesExternaId ? await deps.buscarItens(selecao.producaoImobilizacoesExternaId) : undefined);
  const cateter = await buscarItensDeVariosLotes(deps, selecao.producaoCateterExternaIds);
  const fistula = await buscarItensDeVariosLotes(deps, selecao.producaoFistulaExternaIds);
  const angiografia = await buscarItensDeVariosLotes(deps, selecao.producaoAngiografiaExternaIds);
  const guiasCartaRede = selecao.cartaRedeGuias ?? undefined;
  const guiasManuaisTotal = selecao.guiasManuaisTotal ?? undefined;
  const guiasManuaisMotivo = selecao.guiasManuaisMotivo ?? undefined;

  const historicoGuias = await deps.guiasExecucaoAnterior(medico.id, execucao.competencia);
  const valorConsultaPediatria = await deps.lerValorConsultaPediatria();
  const saldoAcumulado = await deps.buscarSaldoAcumulado(medico.id);

  return {
    resultado,
    medico,
    execucao,
    lotePrincipal,
    outrosHospitais,
    imobilizacoes,
    cateter,
    fistula,
    angiografia,
    itensConsultas,
    guiasCartaRede,
    guiasManuaisTotal,
    guiasManuaisMotivo,
    historicoGuias,
    valorConsultaPediatria,
    saldoAcumulado,
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

  // Busca médico + execução + TODOS os buckets de itens (lote principal com prioridade de
  // sub-lote sobre produção flat, consultas, outros hospitais, imobilizações, cateter/fístula/
  // angiografia — achado 2026-09-02, mesma lógica de `processarUmMedico` no orquestrador
  // principal) — extraído pra `buscarItensDoResultado` (achado 2026-09-04, auditoria 3x1) pra
  // ser reaproveitado também pela rota de auditoria.
  const dados = await buscarItensDoResultado(resultadoId, deps);

  // `saldoAcumulado` deliberadamente OMITIDO da chamada a `processarMedico` abaixo (achado
  // 2026-08-13): este resultado já era 'ok'/'alerta' (bloqueio acima descarta 'acumulado'), ou
  // seja, qualquer saldo que ele tenha consumido da primeira vez já foi limpo de
  // `medicos_saldo_acumulado` — não há o que reinjetar aqui, e o ciclo de acumulação do médico
  // continua rodando normalmente nas próximas execuções. `buscarItensDoResultado` busca
  // `saldoAcumulado` mesmo assim (é usado pela auditoria 3x1, não por este caminho).
  const novoResultado = processarMedico(
    {
      medico: dados.medico,
      itens: dados.lotePrincipal,
      historicoGuias: dados.historicoGuias,
      itensConsultas: dados.itensConsultas,
      itensOutrosHospitais: dados.outrosHospitais,
      itensImobilizacoes: dados.imobilizacoes,
      itensCateter: dados.cateter,
      itensFistula: dados.fistula,
      itensAngiografia: dados.angiografia,
      guiasCartaRede: dados.guiasCartaRede,
      guiasManuaisTotal: dados.guiasManuaisTotal,
      guiasManuaisMotivo: dados.guiasManuaisMotivo,
      competencia: dados.execucao.competencia,
    },
    undefined,
    dados.valorConsultaPediatria,
  );

  return deps.atualizarResultado(resultadoId, novoResultado, usuarioId);
}
