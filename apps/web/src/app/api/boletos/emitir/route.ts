// POST /api/boletos/emitir — emissão de boleto com confirmação manual por médico.
// Regras de negócio (PRD §10):
//   1. Feature flag GATEWAY_EMISSAO_HABILITADA deve estar 'true'.
//   2. Só emite sobre resultado com status 'ok' (nunca alerta/sem_dados).
//   3. Um resultado por vez — sem lote, sem automação.
//   4. Requer confirmação explícita (o médico é o body do request).
//   5. Idempotente: se já existe boleto emitido, retorna 409.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cobrancaMinimaEmissao, type DadosCobranca, type CondicoesCobranca, type ContaEmissora } from '@cobranca/shared';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import { requireRole } from '@/server/auth/require-role';
import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';
import { ZappyGateway } from '@/server/gateway/zappy-gateway';
import { EmailGateway } from '@/server/gateway/email-gateway';
import { calcularVencimento } from '@/server/gateway/vencimento';
import { criarBoleto, buscarBoletoEmitido } from '@/server/repositories/boleto-repository';
import { registrarDisparo } from '@/server/repositories/boleto-disparo-repository';
import { buscarMedico } from '@/server/repositories/medico-repository';
import { buscarEmpresa } from '@/server/repositories/empresa-repository';
import { buscarClienteContabilidade } from '@/server/repositories/cliente-contabilidade-repository';
import { lerConfig, resolverCondicoes } from '@/server/repositories/config-cobranca-repository';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import type { ExecucaoResultadoRow } from '@/server/repositories/mappers';

// Emissão encadeia mTLS (token → POST invoice) + download do PDF + disparos WhatsApp/e-mail —
// não cabe nos 10s default do plano Hobby da Vercel (function morta no meio = boleto emitido
// na Cora sem resposta ao navegador).
export const maxDuration = 60;

// Achado I-1: rate limit — máximo 10 emissões por minuto por usuário.
const emitirLimiter = createRateLimiter('boletos-emitir', { limit: 10, windowMs: 60_000 });

/** Lista os campos MÍNIMOS de cobrança ainda vazios (para mensagem do 422). Endereço e
 *  e-mail não são obrigatórios pra emitir (Épico 6) — a Cora não exige. Mesmo tipo pra médico
 *  e empresa (Story 10.4c) — `DadosCobranca` é compartilhado entre os dois domínios. */
function camposFaltantesCobranca(cobranca: DadosCobranca | null): string[] {
  if (!cobranca) return ['dados de cobrança'];
  const req: Record<string, unknown> = {
    pagadorTipo: cobranca.pagadorTipo,
    pagadorDocumento: cobranca.pagadorDocumento,
    pagadorNome: cobranca.pagadorNome,
  };
  return Object.entries(req)
    .filter(([, v]) => !v || String(v).trim() === '')
    .map(([k]) => k);
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

const bodySchema = z.object({
  execucaoResultadoId: z.string().uuid(),
});

export const POST = withErrorHandler(async (req) => {
  // 1. Auth: somente admin ou financeiro.
  const sessao = await requireRole(['admin', 'financeiro']);
  assertRateLimit(emitirLimiter, sessao.userId, 'emissão de boleto');

  // 2. Feature flag: bloqueia se desligada.
  const env = getServerEnv();
  if (env.GATEWAY_EMISSAO_HABILITADA !== 'true') {
    throw new ApiError(
      403,
      'Emissão de boletos desabilitada. A feature flag GATEWAY_EMISSAO_HABILITADA está desligada. ' +
        'Ligue somente após validação em produção (PRD §10).',
      'EMISSAO_DESABILITADA',
    );
  }

  // 3. Validar body.
  const body = bodySchema.parse(await req.json());

  // 4. Buscar o resultado — rejeitar se status !== 'ok'.
  const db = getSupabaseAdmin();
  const { data: resultado, error: errResult } = await db
    .from('execucao_resultados')
    .select('*, execucoes!inner(competencia)')
    .eq('id', body.execucaoResultadoId)
    .single();

  if (errResult || !resultado) {
    throw new ApiError(404, 'Resultado de execução não encontrado', 'RESULTADO_NAO_ENCONTRADO');
  }

  const resultadoRow = resultado as ExecucaoResultadoRow & { execucoes: { competencia: string } };

  if (resultadoRow.status !== 'ok') {
    throw new ApiError(
      400,
      `Não é permitido emitir boleto sobre resultado com status '${resultadoRow.status}'. ` +
        'Apenas resultados com status \'ok\' podem gerar boleto (PRD §2).',
      'STATUS_INVALIDO',
    );
  }

  if (!resultadoRow.total_valor || resultadoRow.total_valor <= 0) {
    throw new ApiError(400, 'Resultado sem valor para cobrar', 'VALOR_ZERO');
  }

  // A Cora rejeita invoices abaixo de 500 centavos ("amount must be >= 500", verificado em
  // produção 2026-07-09). Falhar aqui com mensagem clara em vez de 502 do gateway.
  const VALOR_MINIMO_GATEWAY = 5;
  if (Number(resultadoRow.total_valor) < VALOR_MINIMO_GATEWAY) {
    throw new ApiError(
      422,
      `Valor do resultado (R$ ${Number(resultadoRow.total_valor).toFixed(2)}) está abaixo do ` +
        'mínimo aceito pelo gateway (R$ 5,00).',
      'VALOR_ABAIXO_MINIMO',
    );
  }

  // 5. Carregar o PAGADOR do resultado — médico, empresa (Story 10.4c) OU cliente contábil
  //    (Story 11.3), nunca mais de um (CHECK chk_execucao_resultados_exclusao_mutua, migration
  //    0032). O pagador do boleto vem do bloco de cobrança dele (não do CPF/nome do resultado,
  //    que é só a chave de cruzamento/exibição).
  let pagadorNomenclatura: string; // "médico"/"empresa"/"cliente contábil" — só para mensagens de erro
  let cobrancaPagador: DadosCobranca | null;
  let condicoesPagador: CondicoesCobranca | null;
  let contaEmissora: ContaEmissora;

  if (resultadoRow.empresa_id) {
    const empresa = await buscarEmpresa(resultadoRow.empresa_id);
    if (!empresa) {
      throw new ApiError(404, 'Empresa do resultado não encontrada', 'EMPRESA_NAO_ENCONTRADA');
    }
    pagadorNomenclatura = 'empresa';
    cobrancaPagador = empresa.cobranca;
    condicoesPagador = empresa.condicoes;
    contaEmissora = empresa.contaEmissora;
  } else if (resultadoRow.cliente_contabilidade_id) {
    const cliente = await buscarClienteContabilidade(resultadoRow.cliente_contabilidade_id);
    if (!cliente) {
      throw new ApiError(404, 'Cliente contábil do resultado não encontrado', 'CLIENTE_CONTABILIDADE_NAO_ENCONTRADO');
    }
    pagadorNomenclatura = 'cliente contábil';
    cobrancaPagador = cliente.cobranca;
    condicoesPagador = cliente.condicoes;
    contaEmissora = cliente.contaEmissora;
  } else if (resultadoRow.medico_id) {
    const medico = await buscarMedico(resultadoRow.medico_id);
    if (!medico) {
      throw new ApiError(404, 'Médico do resultado não encontrado', 'MEDICO_NAO_ENCONTRADO');
    }
    pagadorNomenclatura = 'médico';
    cobrancaPagador = medico.cobranca ?? null;
    condicoesPagador = medico.condicoes ?? null;
    contaEmissora = medico.contaEmissora;
  } else {
    throw new ApiError(422, 'Resultado sem médico, empresa nem cliente contábil vinculado — não é possível cobrar', 'SEM_MEDICO');
  }

  // 6. Guard: falhar cedo (aqui, não no Cora) se faltar o mínimo pra emitir (documento+nome).
  if (!cobrancaMinimaEmissao({ cobranca: cobrancaPagador })) {
    throw new ApiError(
      422,
      `Dados de cobrança d${pagadorNomenclatura === 'empresa' ? 'a' : 'o'} ${pagadorNomenclatura} incompletos — complete antes de emitir o boleto.`,
      'COBRANCA_INCOMPLETA',
      { faltantes: camposFaltantesCobranca(cobrancaPagador) },
    );
  }
  const cobranca = cobrancaPagador!; // garantido por cobrancaMinimaEmissao

  // 7. Resolver as condições comerciais efetivas (override do pagador ?? default global).
  const config = await lerConfig();
  const condicoes = resolverCondicoes(config, condicoesPagador);

  // 8. Idempotência: verificar se já existe boleto emitido.
  const boletoExistente = await buscarBoletoEmitido(body.execucaoResultadoId);
  if (boletoExistente) {
    return NextResponse.json(
      {
        error: {
          code: 'BOLETO_JA_EMITIDO',
          message: 'Já existe boleto emitido para este resultado.',
          boletoId: boletoExistente.id,
        },
      },
      { status: 409 },
    );
  }

  // 9. Emitir via gateway com o pagador completo, pela CONTA EMISSORA do pagador (Story 7.2/10.4c):
  //    o beneficiário do boleto é a empresa (MC/Cavalcante Viana) com quem o médico OU a empresa
  //    do resultado tem contrato. Débito D-721 (gate 7.2): conta sem credenciais configuradas
  //    não pode virar 500 mudo — o operador precisa saber O QUE falta.
  let gateway, nomeGateway;
  try {
    ({ gateway, nome: nomeGateway } = criarBoletoGateway(contaEmissora));
  } catch (e) {
    throw new ApiError(
      503,
      e instanceof Error ? e.message : 'Conta emissora sem credenciais configuradas.',
      'CONTA_NAO_CONFIGURADA',
      { contaEmissora },
    );
  }
  const emissao = await gateway.emitir({
    execucaoResultadoId: body.execucaoResultadoId,
    competencia: resultadoRow.execucoes.competencia,
    valor: Number(resultadoRow.total_valor),
    pagador: {
      nome: cobranca.pagadorNome,
      documento: cobranca.pagadorDocumento,
      tipo: cobranca.pagadorTipo === 'PF' ? 'CPF' : 'CNPJ',
      email: cobranca.email || undefined,
      endereco: enderecoCompletoOuAusente(cobranca),
    },
    condicoes,
  });

  // 10. Persistir na tabela de auditoria (sempre — mesmo falha). Grava o `vencimento` (mesma data
  //     do payment_terms do gateway) para permitir a baixa/aging no ciclo financeiro (Épico 4).
  const boleto = await criarBoleto({
    execucaoResultadoId: body.execucaoResultadoId,
    gateway: nomeGateway,
    idExterno: emissao.idExterno || null,
    status: emissao.status,
    emitidoPor: sessao.userId,
    payloadResposta: emissao.payloadResposta,
    vencimento: calcularVencimento(condicoes.diasVencimento),
    // Desnormalização proposital (arquitetura §3): o boleto grava a conta que o emitiu —
    // cancelamento/reconsulta futuros usam ESTA, mesmo se o médico trocar de empresa.
    contaEmissora,
  });

  if (boleto.status === 'emitido') {
    // A API do Cora retorna o link do boleto em payment_options.bank_slip.url
    const payload = emissao.payloadResposta as any;
    const pdfUrl = payload?.payment_options?.bank_slip?.url;

    if (pdfUrl) {
      // Disparamos o envio aguardando a conclusão para garantir que a function não morra na Vercel
      await Promise.allSettled([
        (async () => {
          if (cobranca.whatsapp) {
            try {
              const zappy = new ZappyGateway();
              await zappy.enviarDocumentoPorUrl(cobranca.whatsapp, pdfUrl);
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
              await emailGtw.enviarBoleto(cobranca.email, cobranca.pagadorNome, pdfUrl, contaEmissora);
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
  }

  const httpStatus = boleto.status === 'emitido' ? 201 : 502;
  return NextResponse.json({ boleto }, { status: httpStatus });
});
