// Emissão de boleto para um resultado de execução — lógica de negócio extraída da rota manual
// (POST /api/boletos/emitir) para reuso pelo orquestrador de lote (revisão de arquitetura
// 2026-07-31, decisões 3 e 5: o bloco de validação/emissão/disparo já estava duplicado e
// divergente entre emitir/route.ts e reenviar_boleto/route.ts — uma terceira cópia no
// orquestrador de lote garantiria que a regra "só emite sobre status 'ok'" e o piso de R$ 5,00
// divergissem na primeira mudança de regra de negócio).
//
// Regras de negócio (PRD §10), preservadas 1:1 da rota manual original:
//   - Só emite sobre resultado com status 'ok' (nunca alerta/sem_dados).
//   - Idempotente: se já existe boleto emitido (ou em processamento — migration 0037), não
//     reemite — devolve o desfecho 'ja_emitido' em vez de lançar, porque isso NÃO é uma falha.
//   - Pagador é médico, empresa (Story 10.4c) OU cliente contábil (Story 11.3), nunca mais de
//     um (CHECK chk_execucao_resultados_exclusao_mutua, migration 0032).
//
// Lança ApiError para toda falha de validação/lookup (resultado não encontrado, status
// inválido, cobrança incompleta, conta sem credenciais etc.) — o chamador HTTP as propaga via
// withErrorHandler sem tradução adicional (mesmo comportamento observável de antes da
// extração). Só os 3 desfechos terminais da emissão em si viram união discriminada: são os
// únicos que importam pra quem decide o que fazer DEPOIS (o orquestrador de lote precisa
// distinguir "já emitido" de "emitido agora" de "o gateway recusou" para decidir se segue o
// lote ou pausa).
//
// `validarResultadoParaEmissao` é exportada separadamente (não é só um detalhe interno) para o
// PREVIEW do lote (emissao-lote-orchestrator.ts) rodar EXATAMENTE a mesma validação, só que sem
// side-effect — a decisão 4 da revisão de arquitetura exige que o pré-voo do lote nunca divirja
// da validação real, senão o preview mostra uma coisa e emite outra.
//
// NÃO faz auth/rate-limit/feature-flag/parsing de request — são responsabilidade do chamador
// (a rota HTTP, ou o orquestrador de lote), que decide o que cada contexto exige antes de
// chegar aqui.
import {
  cobrancaMinimaEmissao,
  documentoValido,
  type DadosCobranca,
  type CondicoesCobranca,
  type ContaEmissora,
  type Boleto,
  type GatewayBoleto,
  type BoletoGatewayPort,
} from '@cobranca/shared';
import { ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';
import { ZappyGateway } from '@/server/gateway/zappy-gateway';
import { EmailGateway } from '@/server/gateway/email-gateway';
import { calcularVencimento } from '@/server/gateway/vencimento';
import { saudacaoPagador, montarLegendaWhatsapp, type PagadorNomenclatura } from '@/server/gateway/mensagem-boleto';
import { reservarBoleto, finalizarBoleto, buscarBoletoEmitido } from '@/server/repositories/boleto-repository';
import { registrarDisparo } from '@/server/repositories/boleto-disparo-repository';
import { resolverPagadorDoResultado } from '@/server/emissao/resolver-pagador';
import { lerConfig, resolverCondicoes } from '@/server/repositories/config-cobranca-repository';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { ExecucaoResultadoRow } from '@/server/repositories/mappers';

// A Cora rejeita invoices abaixo de 500 centavos ("amount must be >= 500", verificado em
// produção 2026-07-09). Falhar aqui com mensagem clara em vez de 502 do gateway.
export const VALOR_MINIMO_GATEWAY = 5;

/** Lista os campos MÍNIMOS de cobrança ainda vazios OU inválidos (para mensagem do 422). Endereço
 *  e e-mail não são obrigatórios pra emitir (Épico 6) — a Cora não exige. Mesmo tipo pra médico
 *  e empresa (Story 10.4c) — `DadosCobranca` é compartilhado entre os dois domínios.
 *  `pagadorDocumento` também entra na lista quando PREENCHIDO mas com dígito verificador inválido
 *  (achado 2026-09-02, caso Yana Clara PF) — sem isso, `cobrancaMinimaEmissao` reprova a emissão
 *  mas esta função devolve `faltantes: []`, deixando o toast sem dizer qual campo é o problema. */
function camposFaltantesCobranca(cobranca: DadosCobranca | null): string[] {
  if (!cobranca) return ['dados de cobrança'];
  const req: Record<string, unknown> = {
    pagadorTipo: cobranca.pagadorTipo,
    pagadorDocumento: cobranca.pagadorDocumento,
    pagadorNome: cobranca.pagadorNome,
  };
  const faltantes = Object.entries(req)
    .filter(([, v]) => !v || String(v).trim() === '')
    .map(([k]) => k);
  if (
    !faltantes.includes('pagadorDocumento') &&
    cobranca.pagadorDocumento &&
    !documentoValido(cobranca.pagadorTipo, cobranca.pagadorDocumento.replace(/\D/g, ''))
  ) {
    faltantes.push('pagadorDocumento');
  }
  return faltantes;
}

/** Endereço só é enviado à Cora se TODOS os subcampos estiverem preenchidos — a API trata
 *  o endereço como tudo-ou-nada (se enviado, todo subcampo vira obrigatório). */
function enderecoCompletoOuAusente(cobranca: DadosCobranca | null) {
  if (!cobranca) return undefined;
  const { cep, logradouro, numero, bairro, cidade, uf, complemento } = cobranca;
  if (![cep, logradouro, numero, bairro, cidade, uf].every((v) => v && String(v).trim() !== '')) {
    return undefined;
  }
  return { cep, logradouro, numero, complemento, bairro, cidade, uf };
}

/** Campos mínimos de `execucao_resultados` necessários pra validar — o preview do lote busca
 *  vários de uma vez e não precisa do join com `execucoes` (só usado depois, pra emitir). */
export interface ResultadoParaEmissao {
  id: string;
  status: string;
  total_valor: number | null;
  empresa_id?: string | null;
  cliente_contabilidade_id?: string | null;
  medico_id: string | null;
}

export interface PagadorValidado {
  pagadorNomenclatura: PagadorNomenclatura;
  cobranca: DadosCobranca;
  condicoesPagador: CondicoesCobranca | null;
  contaEmissora: ContaEmissora;
}

/**
 * Valida um resultado para emissão e resolve o pagador (médico/empresa/cliente contábil) —
 * lança ApiError com os MESMOS códigos usados por `emitirBoletoParaResultado` (status inválido,
 * valor zero/abaixo do mínimo, pagador não encontrado, cobrança incompleta). Não faz
 * idempotência nem resolve o gateway — isso continua em `emitirBoletoParaResultado`, na MESMA
 * ordem de antes (a revisão de arquitetura não pode reordenar validações observáveis).
 */
export async function validarResultadoParaEmissao(resultado: ResultadoParaEmissao): Promise<PagadorValidado> {
  if (resultado.status !== 'ok') {
    throw new ApiError(
      400,
      `Não é permitido emitir boleto sobre resultado com status '${resultado.status}'. ` +
        'Apenas resultados com status \'ok\' podem gerar boleto (PRD §2).',
      'STATUS_INVALIDO',
    );
  }

  if (!resultado.total_valor || resultado.total_valor <= 0) {
    throw new ApiError(400, 'Resultado sem valor para cobrar', 'VALOR_ZERO');
  }

  if (Number(resultado.total_valor) < VALOR_MINIMO_GATEWAY) {
    throw new ApiError(
      422,
      `Valor do resultado (R$ ${Number(resultado.total_valor).toFixed(2)}) está abaixo do ` +
        'mínimo aceito pelo gateway (R$ 5,00).',
      'VALOR_ABAIXO_MINIMO',
    );
  }

  // Carregar o PAGADOR do resultado — médico, empresa (Story 10.4c) OU cliente contábil
  // (Story 11.3), nunca mais de um (CHECK chk_execucao_resultados_exclusao_mutua, migration
  // 0032). O pagador do boleto vem do bloco de cobrança dele (não do CPF/nome do resultado,
  // que é só a chave de cruzamento/exibição). Resolução extraída para resolver-pagador.ts
  // (Épico 13) — reusada também pelo cron de lembrete de vencimento, que não deve herdar as
  // validações de status/valor feitas acima, só a resolução de quem é o pagador.
  const {
    pagadorNomenclatura,
    cobranca: cobrancaPagador,
    condicoesPagador,
    contaEmissora,
  } = await resolverPagadorDoResultado(resultado);

  // Guard: falhar cedo (aqui, não no Cora) se faltar o mínimo pra emitir (documento+nome).
  if (!cobrancaMinimaEmissao({ cobranca: cobrancaPagador })) {
    throw new ApiError(
      422,
      `Dados de cobrança d${pagadorNomenclatura === 'empresa' ? 'a' : 'o'} ${pagadorNomenclatura} incompletos. Complete antes de emitir o boleto.`,
      'COBRANCA_INCOMPLETA',
      { faltantes: camposFaltantesCobranca(cobrancaPagador) },
    );
  }

  return {
    pagadorNomenclatura,
    cobranca: cobrancaPagador!, // garantido por cobrancaMinimaEmissao
    condicoesPagador,
    contaEmissora,
  };
}

/**
 * Resolve o gateway da conta emissora, traduzindo credenciais ausentes em 503 nomeado (débito
 * D-721, gate 7.2) — nunca um 500 mudo. Separado da validação acima porque, na emissão manual,
 * precisa rodar DEPOIS da checagem de idempotência (ordem original preservada — ver
 * `emitirBoletoParaResultado`).
 */
export function resolverGatewayOuFalhar(
  contaEmissora: ContaEmissora,
): { gateway: BoletoGatewayPort; nomeGateway: GatewayBoleto } {
  try {
    const { gateway, nome } = criarBoletoGateway(contaEmissora);
    return { gateway, nomeGateway: nome };
  } catch (e) {
    throw new ApiError(
      503,
      e instanceof Error ? e.message : 'Conta emissora sem credenciais configuradas.',
      'CONTA_NAO_CONFIGURADA',
      { contaEmissora },
    );
  }
}

export interface EmitirBoletoParaResultadoInput {
  execucaoResultadoId: string;
  emitidoPor: string;
  /** Lote de emissão que está processando este item (revisão de arquitetura 2026-07-31,
   *  decisão 5); omitido/null = emissão manual (rota /api/boletos/emitir). */
  loteId?: string | null;
}

export type ResultadoEmissaoBoleto =
  | { tipo: 'emitido'; boleto: Boleto }
  | { tipo: 'falha_gateway'; boleto: Boleto }
  | { tipo: 'ja_emitido'; boletoId: string };

/** Emite um boleto para um resultado de execução — ver cabeçalho do arquivo. */
export async function emitirBoletoParaResultado(
  input: EmitirBoletoParaResultadoInput,
): Promise<ResultadoEmissaoBoleto> {
  const { execucaoResultadoId, emitidoPor, loteId } = input;

  // 1. Buscar o resultado.
  const db = getSupabaseAdmin();
  const { data: resultado, error: errResult } = await db
    .from('execucao_resultados')
    .select('*, execucoes!inner(competencia)')
    .eq('id', execucaoResultadoId)
    .single();

  if (errResult || !resultado) {
    throw new ApiError(404, 'Resultado de execução não encontrado', 'RESULTADO_NAO_ENCONTRADO');
  }

  const resultadoRow = resultado as ExecucaoResultadoRow & { execucoes: { competencia: string } };

  // 2-3. Validar status/valor e resolver o pagador (médico/empresa/cliente contábil).
  const { cobranca, condicoesPagador, contaEmissora, pagadorNomenclatura } = await validarResultadoParaEmissao(resultadoRow);

  // 4. Resolver as condições comerciais efetivas (override do pagador ?? default global).
  const config = await lerConfig();
  const condicoes = resolverCondicoes(config, condicoesPagador);

  // 5. Idempotência: verificar se já existe boleto emitido. NÃO é uma falha — devolve o
  //    desfecho terminal 'ja_emitido' em vez de lançar.
  const boletoExistente = await buscarBoletoEmitido(execucaoResultadoId);
  if (boletoExistente) {
    return { tipo: 'ja_emitido', boletoId: boletoExistente.id };
  }

  // 6. Resolver o gateway da conta ANTES de reservar — falha de config (conta sem credenciais)
  //    não deve deixar uma reserva órfã.
  const { gateway, nomeGateway } = resolverGatewayOuFalhar(contaEmissora);

  // 7. RESERVA a linha com status 'processando' ANTES de chamar o gateway (migration 0037 —
  //     Achados 1/2 da revisão de arquitetura do lote). O índice único parcial no banco é a
  //     barreira REAL contra corrida; uma segunda reserva concorrente vira 409 BOLETO_JA_EMITIDO
  //     aqui dentro. O id da reserva é a Idempotency-Key desta emissão.
  const reserva = await reservarBoleto({
    execucaoResultadoId,
    gateway: nomeGateway,
    emitidoPor,
    // Desnormalização proposital (arquitetura §3): o boleto grava a conta que o emitiu —
    // cancelamento/reconsulta futuros usam ESTA, mesmo se o médico trocar de empresa.
    contaEmissora,
    loteId,
  });

  // 8. Emitir via gateway com o pagador completo, pela CONTA EMISSORA do pagador (Story 7.2/10.4c):
  //    o beneficiário do boleto é a empresa (MC/Cavalcante Viana) com quem o médico OU a empresa
  //    do resultado tem contrato.
  const emissao = await gateway.emitir(
    {
      execucaoResultadoId,
      competencia: resultadoRow.execucoes.competencia,
      valor: Number(resultadoRow.total_valor),
      quantidadeGuias: resultadoRow.guias,
      pagador: {
        nome: cobranca.pagadorNome,
        documento: cobranca.pagadorDocumento,
        tipo: cobranca.pagadorTipo === 'PF' ? 'CPF' : 'CNPJ',
        email: cobranca.email || undefined,
        endereco: enderecoCompletoOuAusente(cobranca),
      },
      condicoes,
    },
    reserva.id,
  );

  // 9. Finaliza a reserva com o resultado real do gateway (sempre — mesmo falha). Grava o
  //    `vencimento` (mesma data do payment_terms do gateway) para permitir a baixa/aging no
  //    ciclo financeiro (Épico 4).
  const boleto = await finalizarBoleto(reserva.id, {
    status: emissao.status,
    idExterno: emissao.idExterno || null,
    payloadResposta: emissao.payloadResposta,
    vencimento: calcularVencimento(condicoes),
  });

  if (boleto.status !== 'emitido') {
    return { tipo: 'falha_gateway', boleto };
  }

  // 10. A API do Cora retorna o link do boleto em payment_options.bank_slip.url — disparamos o
  //     envio aguardando a conclusão para garantir que a function não morra na Vercel.
  const payload = emissao.payloadResposta as any;
  const pdfUrl = payload?.payment_options?.bank_slip?.url;

  if (pdfUrl) {
    await Promise.allSettled([
      (async () => {
        if (cobranca.whatsapp) {
          try {
            const zappy = new ZappyGateway();
            const pixDisponivel = getServerEnv().EMISSAO_PIX_HABILITADA === 'true';
            await zappy.enviarDocumentoPorUrl(cobranca.whatsapp, pdfUrl, montarLegendaWhatsapp(cobranca, boleto.vencimento!, pagadorNomenclatura, pixDisponivel));
            await registrarDisparo({ boletoId: boleto.id, canal: 'whatsapp', status: 'sucesso' });
          } catch (err: any) {
            await registrarDisparo({ boletoId: boleto.id, canal: 'whatsapp', status: 'falha', mensagemErro: err.message || 'Erro desconhecido' });
            throw err;
          }
        }
      })(),
      (async () => {
        if (cobranca.email) {
          try {
            const emailGtw = new EmailGateway();
            await emailGtw.enviarBoleto(cobranca.email, saudacaoPagador(cobranca), boleto.vencimento!, pdfUrl, pagadorNomenclatura);
            await registrarDisparo({ boletoId: boleto.id, canal: 'email', status: 'sucesso' });
          } catch (err: any) {
            await registrarDisparo({ boletoId: boleto.id, canal: 'email', status: 'falha', mensagemErro: err.message || 'Erro desconhecido' });
            throw err;
          }
        }
      })(),
    ]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[Disparo Boleto] Erro na task ${i === 0 ? 'Zappy' : 'Email'}:`, r.reason);
        }
      });
    });
  }

  return { tipo: 'emitido', boleto };
}
