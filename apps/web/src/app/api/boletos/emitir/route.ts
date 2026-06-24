// POST /api/boletos/emitir — emissão de boleto com confirmação manual por médico.
// Regras de negócio (PRD §10):
//   1. Feature flag GATEWAY_EMISSAO_HABILITADA deve estar 'true'.
//   2. Só emite sobre resultado com status 'ok' (nunca alerta/sem_dados).
//   3. Um resultado por vez — sem lote, sem automação.
//   4. Requer confirmação explícita (o médico é o body do request).
//   5. Idempotente: se já existe boleto emitido, retorna 409.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import { requireRole } from '@/server/auth/require-role';
import { criarBoletoGateway } from '@/server/gateway/boleto-gateway-factory';
import { criarBoleto, buscarBoletoEmitido } from '@/server/repositories/boleto-repository';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { ExecucaoResultadoRow } from '@/server/repositories/mappers';

const bodySchema = z.object({
  execucaoResultadoId: z.string().uuid(),
});

export const POST = withErrorHandler(async (req) => {
  // 1. Auth: somente admin ou financeiro.
  const sessao = await requireRole(['admin', 'financeiro']);

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

  // 5. Idempotência: verificar se já existe boleto emitido.
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

  // 6. Emitir via gateway.
  const { gateway, nome: nomeGateway } = criarBoletoGateway();
  const emissao = await gateway.emitir({
    execucaoResultadoId: body.execucaoResultadoId,
    cpfMedico: resultadoRow.cpf,
    nomeMedico: resultadoRow.nome,
    competencia: resultadoRow.execucoes.competencia,
    valor: Number(resultadoRow.total_valor),
  });

  // 7. Persistir na tabela de auditoria (sempre — mesmo falha).
  const boleto = await criarBoleto({
    execucaoResultadoId: body.execucaoResultadoId,
    gateway: nomeGateway,
    idExterno: emissao.idExterno || null,
    status: emissao.status,
    emitidoPor: sessao.userId,
    payloadResposta: emissao.payloadResposta,
  });

  const httpStatus = boleto.status === 'emitido' ? 201 : 502;
  return NextResponse.json({ boleto }, { status: httpStatus });
});
