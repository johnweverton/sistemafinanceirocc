import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { requireRole } from '@/server/auth/require-role';
import { buscarBoletoEmitido } from '@/server/repositories/boleto-repository';
import { registrarDisparo } from '@/server/repositories/boleto-disparo-repository';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ZappyGateway } from '@/server/gateway/zappy-gateway';
import { EmailGateway } from '@/server/gateway/email-gateway';
import { saudacaoPagador, montarLegendaWhatsapp } from '@/server/gateway/mensagem-boleto';
import { buscarMedico } from '@/server/repositories/medico-repository';

export const POST = withErrorHandler<{ id: string }>(async (_req, { params }) => {
  await requireRole(['admin', 'financeiro']);

  const resultadoId = params.id;
  
  // 1. Encontrar o boleto emitido para este resultado
  const boleto = await buscarBoletoEmitido(resultadoId);
  if (!boleto) {
    throw new ApiError(404, 'Nenhum boleto emitido para este resultado', 'BOLETO_NAO_ENCONTRADO');
  }
  
  if (boleto.status !== 'emitido') {
    throw new ApiError(400, 'Apenas boletos emitidos com sucesso podem ser reenviados', 'STATUS_INVALIDO');
  }

  // 2. Encontrar o Médico para os dados de contato
  const db = getSupabaseAdmin();
  const { data: resultado, error: errResult } = await db
    .from('execucao_resultados')
    .select('medico_id')
    .eq('id', resultadoId)
    .single();

  if (errResult || !resultado || !resultado.medico_id) {
    throw new ApiError(404, 'Médico não encontrado para este resultado', 'MEDICO_NAO_ENCONTRADO');
  }

  const medico = await buscarMedico(resultado.medico_id);
  if (!medico || !medico.cobranca) {
    throw new ApiError(422, 'Dados de cobrança do médico incompletos', 'COBRANCA_INCOMPLETA');
  }

  const cobranca = medico.cobranca;
  const payload = boleto.payloadResposta as any;
  const pdfUrl = payload?.payment_options?.bank_slip?.url;

  if (!pdfUrl) {
    throw new ApiError(422, 'Boleto não possui PDF para envio', 'PDF_INDISPONIVEL');
  }

  // 3. Disparar e aguardar para retornar feedback síncrono
  const results = await Promise.allSettled([
    (async () => {
      if (cobranca.whatsapp) {
        try {
          const zappy = new ZappyGateway();
          await zappy.enviarDocumentoPorUrl(cobranca.whatsapp, pdfUrl, montarLegendaWhatsapp(cobranca, boleto.vencimento!));
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
          await emailGtw.enviarBoleto(cobranca.email, saudacaoPagador(cobranca), boleto.vencimento!, pdfUrl);
          await registrarDisparo({ boletoId: boleto.id, canal: 'email', status: 'sucesso' });
        } catch (err: any) {
          await registrarDisparo({ boletoId: boleto.id, canal: 'email', status: 'falha', mensagemErro: err.message || 'Erro desconhecido' });
          throw err;
        }
      }
    })(),
  ]);

  const falhas = results.filter(r => r.status === 'rejected');
  
  if (falhas.length === 2) {
    return NextResponse.json({ message: 'Falha ao reenviar por todos os canais.' }, { status: 502 });
  }

  return NextResponse.json({ message: 'Reenvio processado com sucesso.' }, { status: 200 });
});
