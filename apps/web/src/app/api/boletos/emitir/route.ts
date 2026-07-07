// POST /api/boletos/emitir — emissão de boleto com confirmação manual por médico.
// Regras de negócio (PRD §10):
//   1. Feature flag GATEWAY_EMISSAO_HABILITADA deve estar 'true'.
//   2. Só emite sobre resultado com status 'ok' (nunca alerta/sem_dados).
//   3. Um resultado por vez — sem lote, sem automação.
//   4. Requer confirmação explícita (o médico é o body do request).
//   5. Idempotente: se já existe boleto emitido, retorna 409.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cobrancaCompleta } from '@cobranca/shared';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import { requireRole } from '@/server/auth/require-role';
import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';
import { calcularVencimento } from '@/server/gateway/vencimento';
import { criarBoleto, buscarBoletoEmitido } from '@/server/repositories/boleto-repository';
import { buscarMedico } from '@/server/repositories/medico-repository';
import { lerConfig, resolverCondicoes } from '@/server/repositories/config-cobranca-repository';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createRateLimiter, assertRateLimit } from '@/lib/rate-limit';
import type { ExecucaoResultadoRow } from '@/server/repositories/mappers';

// Achado I-1: rate limit — máximo 10 emissões por minuto por usuário.
const emitirLimiter = createRateLimiter('boletos-emitir', { limit: 10, windowMs: 60_000 });

/** Lista os campos obrigatórios de cobrança ainda vazios (para mensagem do 422). */
function camposFaltantesCobranca(cobranca: NonNullable<Awaited<ReturnType<typeof buscarMedico>>>['cobranca']): string[] {
  if (!cobranca) return ['dados de cobrança'];
  const req: Record<string, unknown> = {
    pagadorTipo: cobranca.pagadorTipo,
    pagadorDocumento: cobranca.pagadorDocumento,
    pagadorNome: cobranca.pagadorNome,
    email: cobranca.email,
    cep: cobranca.cep,
    logradouro: cobranca.logradouro,
    numero: cobranca.numero,
    bairro: cobranca.bairro,
    cidade: cobranca.cidade,
    uf: cobranca.uf,
  };
  return Object.entries(req)
    .filter(([, v]) => !v || String(v).trim() === '')
    .map(([k]) => k);
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

  // 5. Carregar o médico do resultado — o pagador do boleto vem do bloco de cobrança dele
  //    (não do CPF do resultado, que é só a chave de cruzamento com a API da Carmem).
  if (!resultadoRow.medico_id) {
    throw new ApiError(422, 'Resultado sem médico vinculado — não é possível cobrar', 'SEM_MEDICO');
  }
  const medico = await buscarMedico(resultadoRow.medico_id);
  if (!medico) {
    throw new ApiError(404, 'Médico do resultado não encontrado', 'MEDICO_NAO_ENCONTRADO');
  }

  // 6. Guard: falhar cedo (aqui, não no Cora) se a cobrança estiver incompleta.
  if (!cobrancaCompleta(medico)) {
    throw new ApiError(
      422,
      'Dados de cobrança do médico incompletos — complete antes de emitir o boleto.',
      'COBRANCA_INCOMPLETA',
      { faltantes: camposFaltantesCobranca(medico.cobranca) },
    );
  }
  const cobranca = medico.cobranca!; // garantido por cobrancaCompleta

  // 7. Resolver as condições comerciais efetivas (override do médico ?? default global).
  const config = await lerConfig();
  const condicoes = resolverCondicoes(config, medico.condicoes);

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

  // 9. Emitir via gateway com o pagador completo.
  const { gateway, nome: nomeGateway } = criarBoletoGateway();
  const emissao = await gateway.emitir({
    execucaoResultadoId: body.execucaoResultadoId,
    competencia: resultadoRow.execucoes.competencia,
    valor: Number(resultadoRow.total_valor),
    pagador: {
      nome: cobranca.pagadorNome,
      documento: cobranca.pagadorDocumento,
      tipo: cobranca.pagadorTipo === 'PF' ? 'CPF' : 'CNPJ',
      email: cobranca.email,
      endereco: {
        cep: cobranca.cep,
        logradouro: cobranca.logradouro,
        numero: cobranca.numero,
        complemento: cobranca.complemento,
        bairro: cobranca.bairro,
        cidade: cobranca.cidade,
        uf: cobranca.uf,
      },
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
  });

  const httpStatus = boleto.status === 'emitido' ? 201 : 502;
  return NextResponse.json({ boleto }, { status: httpStatus });
});
