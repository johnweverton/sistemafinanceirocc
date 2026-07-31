// Emissão de boletos em lote — orquestrador (revisão de arquitetura 2026-07-31, decisão 5).
// Mesmo padrão do execucao-orchestrator.ts (deps injetáveis via funções puras + encadeamento de
// lotes por HTTP interno com X-Internal-Secret), com um desvio deliberado: o cursor NÃO é
// contagem (`contarResultados`) — é a fila explícita `lote_emissao_itens.status = 'pendente'`,
// porque aqui os itens são pulados/falham e podem ser reprocessados seletivamente (não é
// "processa todo mundo em ordem", é "processa o que ainda está pendente").
//
// Fase A (preview, síncrono, só leitura) → `montarPreviewLote`.
// Fase B (confirmação) → repositório `confirmarLote` (revalidação de snapshot fica na rota).
// Fase C (processamento assíncrono, encadeado) → `processarProximoLoteEmissao`.
//
// Circuit breaker (decisão 2, persistido em `lotes_emissao` — não em memória, o lote atravessa
// múltiplas invocações serverless):
//   - Falha do ITEM (dado de cadastro — COBRANCA_INCOMPLETA, VALOR_ABAIXO_MINIMO,
//     BOLETO_JA_EMITIDO, SEM_MEDICO etc.): marca o item, CONTINUA o lote, não conta para o
//     breaker ("é dado ruim de um cadastro, não sinal de nada").
//   - Falha de GATEWAY (o Cora recusou, emissao.status === 'falha'): conta para o breaker.
//   - Falha SISTÊMICA (CONTA_NAO_CONFIGURADA, erro inesperado, qualquer 5xx): pausa IMEDIATA.
//   - Gatilhos de pausa: 3 falhas de gateway consecutivas, OU taxa de falha de gateway > 20%
//     com ≥ 10 itens tentados (emitido+falha_gateway), OU qualquer falha sistêmica.
import { ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import type { LoteEmissao, LoteEmissaoItem } from '@cobranca/shared';
import { executarComLimite } from './concorrencia';
import { emitirBoletoParaResultado, validarResultadoParaEmissao, resolverGatewayOuFalhar } from '@/server/emissao/emitir-boleto';
import { buscarBoletoEmitido } from '@/server/repositories/boleto-repository';
import { listarResultadosOkParaEmissao } from '@/server/repositories/execucao-repository';
import {
  criarLoteComItens,
  buscarLote,
  listarItensPendentes,
  contarItensPorStatus,
  atualizarItemLote,
  atualizarProgressoLote,
  pausarLotePorFalhas,
  concluirLote,
  somarValorEmitido,
  type NovoItemLote,
} from '@/server/repositories/lote-emissao-repository';

/** Itens por invocação. Com concorrência 3 e ~5s/item: ~42s por invocação, folga ampla dentro
 *  do maxDuration=300 da rota de processamento. Lote menor = menos trabalho perdido se a
 *  function morrer no meio (checkpoint mais frequente no banco). */
export const EMISSAO_LOTE_BATCH_SIZE = 25;
/** Cada item é escrita financeira irreversível (mTLS + OAuth + POST invoice + Zappy + SMTP) —
 *  concorrência bem mais conservadora que a leitura idempotente de execucao-orchestrator (8). */
export const EMISSAO_LOTE_CONCORRENCIA = 3;
export const EMISSAO_LOTE_MAX_FALHAS_CONSECUTIVAS = 3;
export const EMISSAO_LOTE_TAXA_FALHA_MAX = 0.2;
export const EMISSAO_LOTE_MIN_ITENS_PARA_TAXA = 10;
/** Recusa o preview acima disso — um filtro errado não vira um lote de milhares. */
export const EMISSAO_LOTE_MAX_ITENS = 200;

// ---------------------------------------------------------------------------
// Fase A — Preview
// ---------------------------------------------------------------------------

export interface MontarPreviewLoteParams {
  execucaoId: string;
  criadoPor: string;
}

/**
 * Monta o preview do lote: valida CADA candidato com a MESMA função usada na emissão real
 * (`validarResultadoParaEmissao` + `resolverGatewayOuFalhar`) — o preview nunca pode divergir
 * da validação real, senão mostra uma coisa e emite outra (decisão 4). Itens reprovados
 * entram como 'pulado' com o motivo — não somem da tela.
 */
export async function montarPreviewLote(params: MontarPreviewLoteParams): Promise<LoteEmissao> {
  const candidatos = await listarResultadosOkParaEmissao(params.execucaoId);

  if (candidatos.length === 0) {
    throw new ApiError(422, "Nenhum resultado com status 'ok' encontrado nesta execução.", 'SEM_CANDIDATOS');
  }
  if (candidatos.length > EMISSAO_LOTE_MAX_ITENS) {
    throw new ApiError(
      422,
      `Esta execução tem ${candidatos.length} resultados 'ok' — acima do limite de ${EMISSAO_LOTE_MAX_ITENS} por lote.`,
      'LOTE_MUITO_GRANDE',
    );
  }

  const itens: NovoItemLote[] = [];
  let totalValor = 0;
  let totalAceitos = 0;

  for (const candidato of candidatos) {
    // Já tem boleto ativo (emitido/pago/processando) — idempotência: não é candidato, e não é
    // um "erro" pro operador ver, então nem entra como 'pulado'.
    const jaEmitido = await buscarBoletoEmitido(candidato.id);
    if (jaEmitido) continue;

    try {
      const { contaEmissora } = await validarResultadoParaEmissao(candidato);
      resolverGatewayOuFalhar(contaEmissora); // pré-voo de credenciais; preview não guarda o gateway

      itens.push({
        execucaoResultadoId: candidato.id,
        contaEmissora,
        valorSnapshot: Number(candidato.total_valor),
        status: 'pendente',
      });
      totalValor += Number(candidato.total_valor);
      totalAceitos += 1;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e; // erro inesperado (bug) não deve ser engolido
      itens.push({
        execucaoResultadoId: candidato.id,
        contaEmissora: null,
        valorSnapshot: Number(candidato.total_valor ?? 0),
        status: 'pulado',
        codigoErro: e.code,
        mensagemErro: e.message,
      });
    }
  }

  if (totalAceitos === 0) {
    throw new ApiError(
      422,
      'Nenhum resultado elegível para emissão nesta execução (todos já emitidos, com cadastro incompleto, ou sem pagador).',
      'SEM_ITENS_ELEGIVEIS',
    );
  }

  return criarLoteComItens({
    escopoTipo: 'execucao',
    escopoRef: params.execucaoId,
    criadoPor: params.criadoPor,
    snapshotTotalItens: totalAceitos,
    snapshotTotalValor: totalValor,
    itens,
  });
}

// ---------------------------------------------------------------------------
// Fase C — Processamento
// ---------------------------------------------------------------------------

type DesfechoItem = 'emitido' | 'neutro' | 'falha_gateway' | 'sistemica';

interface ResultadoItemProcessado {
  desfecho: DesfechoItem;
  codigoSistemica?: string;
}

/** Processa um item: nunca rejeita (contrato de `executarComLimite`) — todo desfecho grava o
 *  item e devolve uma classificação para o circuit breaker decidir depois. */
async function processarItemLote(item: LoteEmissaoItem, lote: LoteEmissao): Promise<ResultadoItemProcessado> {
  try {
    const resultado = await emitirBoletoParaResultado({
      execucaoResultadoId: item.execucaoResultadoId,
      // Garantido: só chega aqui com lote.status === 'processando', que só existe depois de
      // `confirmarLote` gravar confirmadoPor.
      emitidoPor: lote.confirmadoPor!,
      loteId: lote.id,
    });

    if (resultado.tipo === 'emitido') {
      await atualizarItemLote(item.id, { status: 'emitido', boletoId: resultado.boleto.id });
      return { desfecho: 'emitido' };
    }
    if (resultado.tipo === 'ja_emitido') {
      // Emitido manualmente (ou por outro lote) entre o preview e agora — não é falha.
      await atualizarItemLote(item.id, { status: 'pulado', codigoErro: 'BOLETO_JA_EMITIDO' });
      return { desfecho: 'neutro' };
    }
    // 'falha_gateway': a Cora recusou (ou erro de rede) — conta para o breaker.
    await atualizarItemLote(item.id, {
      status: 'falha',
      codigoErro: 'FALHA_GATEWAY',
      mensagemErro: 'O gateway recusou a emissão — ver auditoria do boleto para detalhes.',
      boletoId: resultado.boleto.id,
    });
    return { desfecho: 'falha_gateway' };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) {
        // Corrida (BOLETO_JA_EMITIDO do reservarBoleto) — mesmo espírito do 'ja_emitido' acima.
        await atualizarItemLote(item.id, { status: 'pulado', codigoErro: e.code, mensagemErro: e.message });
        return { desfecho: 'neutro' };
      }
      if (e.status >= 500) {
        // CONTA_NAO_CONFIGURADA ou outra falha sistêmica — pausa o lote imediatamente.
        await atualizarItemLote(item.id, { status: 'falha', codigoErro: e.code, mensagemErro: e.message });
        return { desfecho: 'sistemica', codigoSistemica: e.code };
      }
      // 400/404/422 — cadastro mudou entre o preview e agora (dado ruim, não sinal de nada).
      await atualizarItemLote(item.id, { status: 'falha', codigoErro: e.code, mensagemErro: e.message });
      return { desfecho: 'neutro' };
    }
    // Erro inesperado (bug) — conservador: trata como sistêmica em vez de continuar às cegas.
    await atualizarItemLote(item.id, { status: 'falha', codigoErro: 'ERRO_INESPERADO', mensagemErro: String(e) });
    return { desfecho: 'sistemica', codigoSistemica: 'ERRO_INESPERADO' };
  }
}

/** Progresso 0-100 a partir de quantos itens (do total aceito no preview) ainda estão pendentes. */
export function calcularProgressoLote(pendentes: number, totalAceitos: number): number {
  if (totalAceitos <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round(((totalAceitos - pendentes) / totalAceitos) * 100)));
}

/**
 * Processa o próximo lote de itens pendentes. Idempotente/seguro de re-chamar: se o lote não
 * estiver 'processando' (já pausado/concluído por outra invocação concorrente), não faz nada.
 */
export async function processarProximoLoteEmissao(loteId: string): Promise<void> {
  const lote = await buscarLote(loteId);
  if (!lote) throw new Error(`Lote de emissão ${loteId} não encontrado`);
  if (lote.status !== 'processando') return;

  const itens = await listarItensPendentes(loteId, EMISSAO_LOTE_BATCH_SIZE);
  if (itens.length === 0) {
    await finalizarLoteConcluido(loteId);
    return;
  }

  const resultados: ResultadoItemProcessado[] = new Array(itens.length);
  await executarComLimite(itens, EMISSAO_LOTE_CONCORRENCIA, async (item, indice) => {
    resultados[indice] = await processarItemLote(item, lote);
  });

  // Classificação em ORDEM de busca (não de conclusão — concorrência limitada preserva a ordem
  // de `itens` no array `resultados`, indexado por posição): sistêmica pausa IMEDIATAMENTE;
  // falha de gateway soma nas consecutivas (carregadas do lote); 'emitido' zera a sequência;
  // 'neutro' não mexe (não é sinal de nada).
  let consecutivas = lote.falhasConsecutivas;
  let motivoSistemica: string | null = null;
  for (const r of resultados) {
    if (r.desfecho === 'sistemica') {
      motivoSistemica = r.codigoSistemica ?? 'FALHA_SISTEMICA';
      break;
    }
    if (r.desfecho === 'falha_gateway') consecutivas += 1;
    else if (r.desfecho === 'emitido') consecutivas = 0;
  }

  if (motivoSistemica) {
    await pausarLotePorFalhas(loteId, {
      motivoPausa: `Falha sistêmica: ${motivoSistemica}`,
      falhasConsecutivas: consecutivas,
    });
    return;
  }

  if (consecutivas >= EMISSAO_LOTE_MAX_FALHAS_CONSECUTIVAS) {
    await pausarLotePorFalhas(loteId, {
      motivoPausa: `${consecutivas} falhas de gateway consecutivas`,
      falhasConsecutivas: consecutivas,
    });
    return;
  }

  const contagens = await contarItensPorStatus(loteId);
  const tentativas = contagens.emitido + contagens.falhaGateway;
  if (tentativas >= EMISSAO_LOTE_MIN_ITENS_PARA_TAXA && contagens.falhaGateway / tentativas > EMISSAO_LOTE_TAXA_FALHA_MAX) {
    await pausarLotePorFalhas(loteId, {
      motivoPausa:
        `Taxa de falha de gateway acima de ${Math.round(EMISSAO_LOTE_TAXA_FALHA_MAX * 100)}% ` +
        `(${contagens.falhaGateway}/${tentativas})`,
      falhasConsecutivas: consecutivas,
    });
    return;
  }

  await atualizarProgressoLote(loteId, {
    progresso: calcularProgressoLote(contagens.pendente, lote.snapshotTotalItens),
    falhasConsecutivas: consecutivas,
  });

  if (contagens.pendente > 0) {
    await agendarProximoLoteEmissaoHttp(loteId);
  } else {
    await finalizarLoteConcluido(loteId);
  }
}

async function finalizarLoteConcluido(loteId: string): Promise<void> {
  const contagens = await contarItensPorStatus(loteId);
  const valorEmitido = await somarValorEmitido(loteId);
  await concluirLote(loteId, {
    totalEmitidos: contagens.emitido,
    totalPulados: contagens.pulado,
    totalFalhas: contagens.falhaGateway + contagens.falhaOutra,
    totalValorEmitido: valorEmitido,
  });
}

/** Encadeamento real do próximo lote via HTTP interno protegido por X-Internal-Secret — mesmo
 *  padrão de `agendarProximoLoteHttp` em execucao-orchestrator.ts. */
async function agendarProximoLoteEmissaoHttp(loteId: string): Promise<void> {
  const env = getServerEnv();
  if (!env.INTERNAL_SECRET || !env.APP_BASE_URL) {
    throw new Error('INTERNAL_SECRET/APP_BASE_URL não configurados para encadear lotes de emissão');
  }
  const url = new URL(`/api/boletos/lotes/${loteId}/processar`, env.APP_BASE_URL);
  void fetch(url, {
    method: 'POST',
    headers: { 'X-Internal-Secret': env.INTERNAL_SECRET },
  }).catch((e) => {
    console.error('[emissao-lote] falha ao encadear próximo lote', loteId, e);
  });
}

/** Helper para as rotas de confirmar/retomar: dispara o processamento sem aguardar (fire-and-
 *  forget) e nunca deixa uma exceção não tratada escapar — falha inesperada pausa o lote em vez
 *  de travar em 'processando' para sempre sem ninguém saber por quê. */
export async function dispararProcessamentoLoteEmissao(loteId: string): Promise<void> {
  try {
    await processarProximoLoteEmissao(loteId);
  } catch (e) {
    console.error('[emissao-lote] erro inesperado processando lote', loteId, e);
    await pausarLotePorFalhas(loteId, {
      motivoPausa: `Erro inesperado no processamento: ${String(e)}`,
      falhasConsecutivas: 0,
    }).catch(() => {
      // Se nem isso funcionar, é queda de banco — nada mais a fazer aqui; fica 'processando'
      // e o operador precisa investigar diretamente.
    });
  }
}
