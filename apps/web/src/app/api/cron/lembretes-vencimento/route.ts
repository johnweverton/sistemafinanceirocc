// GET /api/cron/lembretes-vencimento — Vercel Cron, D-1: para todo boleto em aberto (cobrança
// médica E contabilidade, 4 contas emissoras) que vence AMANHÃ, manda um lembrete preventivo por
// WhatsApp/e-mail (Épico 13, Fase 1 — GATE do dono: só preventivo; reforço pós-vencimento é uma
// Fase 2 futura, não implementada aqui). Mesma autenticação do cron de relatório mensal (Bearer
// CRON_SECRET, comparado em tempo constante, fail-closed sem CRON_SECRET configurado).
import { timingSafeEqual } from 'node:crypto';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { listarBoletosVencendoEm } from '@/server/repositories/boleto-repository';
import { resolverPagadorDoResultado } from '@/server/emissao/resolver-pagador';
import { registrarDisparo, jaDisparado } from '@/server/repositories/boleto-disparo-repository';
import { ZappyGateway } from '@/server/gateway/zappy-gateway';
import { EmailGateway } from '@/server/gateway/email-gateway';
import { saudacaoPagador, montarLegendaLembreteWhatsapp } from '@/server/gateway/mensagem-boleto';
import { lerConfig as lerConfigLembrete } from '@/server/repositories/config-lembrete-vencimento-repository';

// Pedido de duração maior no plano Pro; ignorado silenciosamente no Hobby (limite fixo de 10s).
export const maxDuration = 60;

function segredosBatem(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * "Amanhã" em AAAA-MM-DD, no fuso de Brasília (não em UTC puro). O Vercel Cron dispara em UTC —
 * replicar ingenuamente o cálculo de "dia" do cron de relatório mensal (getUTCDate) arriscaria
 * calcular o dia errado perto da virada de meia-noite UTC (21h em Brasília). Usa Intl em vez de
 * hardcodar o offset -03:00 como defesa contra mudança futura de política de fuso do país.
 */
function amanhaBrasilia(): string {
  const hojeBR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const partes = hojeBR.split('-').map(Number);
  const ano = partes[0] ?? 0;
  const mes = partes[1] ?? 1;
  const dia = partes[2] ?? 1;
  return new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
}

export const GET = withErrorHandler(async (req) => {
  const env = getServerEnv();
  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined;
  if (!env.CRON_SECRET || !segredosBatem(bearer, env.CRON_SECRET)) {
    throw new ApiError(401, 'Segredo de cron inválido ou não configurado', 'UNAUTHORIZED');
  }

  const config = await lerConfigLembrete();
  if (!config.habilitado) {
    console.warn('[cron/lembretes-vencimento] Lembrete desabilitado — pulando.');
    return Response.json({ enviado: false, motivo: 'Lembrete de vencimento desabilitado' });
  }

  const dataAlvo = amanhaBrasilia();
  const candidatos = await listarBoletosVencendoEm(dataAlvo);

  const db = getSupabaseAdmin();
  let enviados = 0;
  let falhas = 0;
  let pulados = 0;

  for (const boleto of candidatos) {
    // Idempotência: já existe lembrete registrado para este boleto? (índice
    // idx_boletos_disparos_boleto_tipo). O índice único parcial na migration 0056 fecha a corrida
    // de fato — esta checagem só evita a tentativa de reenvio na maioria dos casos.
    if (await jaDisparado(boleto.boletoId, 'lembrete_vencimento')) {
      pulados++;
      continue;
    }

    const pdfUrl = (boleto.payloadResposta as any)?.payment_options?.bank_slip?.url;
    if (!pdfUrl) {
      pulados++; // sem PDF, nada a enviar — não deveria acontecer em status='emitido'
      continue;
    }

    const { data: resultado } = await db
      .from('execucao_resultados')
      .select('medico_id, empresa_id, cliente_contabilidade_id')
      .eq('id', boleto.execucaoResultadoId)
      .maybeSingle();
    if (!resultado) {
      pulados++;
      continue;
    }

    let pagador;
    try {
      pagador = await resolverPagadorDoResultado(resultado);
    } catch {
      pulados++; // pagador não encontrado — não derruba o cron inteiro por um boleto órfão
      continue;
    }

    const cobranca = pagador.cobranca;
    if (!cobranca || (!cobranca.whatsapp && !cobranca.email)) {
      pulados++; // sem nenhum contato preenchido — não é falha de envio, é ausência de canal
      continue;
    }

    const resultados = await Promise.allSettled([
      (async () => {
        if (!cobranca.whatsapp) return;
        try {
          await new ZappyGateway().enviarDocumentoPorUrl(
            cobranca.whatsapp,
            pdfUrl,
            montarLegendaLembreteWhatsapp(cobranca, boleto.vencimento, pagador.pagadorNomenclatura),
          );
          await registrarDisparo({ boletoId: boleto.boletoId, canal: 'whatsapp', status: 'sucesso', tipo: 'lembrete_vencimento' });
        } catch (err: any) {
          if (err instanceof ApiError && err.code === 'DISPARO_DUPLICADO') return; // idempotência já satisfeita
          await registrarDisparo({ boletoId: boleto.boletoId, canal: 'whatsapp', status: 'falha', mensagemErro: err.message ?? 'Erro desconhecido', tipo: 'lembrete_vencimento' });
          throw err;
        }
      })(),
      (async () => {
        if (!cobranca.email) return;
        try {
          await new EmailGateway().enviarLembreteVencimento(cobranca.email, saudacaoPagador(cobranca), boleto.vencimento, pdfUrl, pagador.pagadorNomenclatura);
          await registrarDisparo({ boletoId: boleto.boletoId, canal: 'email', status: 'sucesso', tipo: 'lembrete_vencimento' });
        } catch (err: any) {
          if (err instanceof ApiError && err.code === 'DISPARO_DUPLICADO') return; // idempotência já satisfeita
          await registrarDisparo({ boletoId: boleto.boletoId, canal: 'email', status: 'falha', mensagemErro: err.message ?? 'Erro desconhecido', tipo: 'lembrete_vencimento' });
          throw err;
        }
      })(),
    ]);

    if (resultados.some((r) => r.status === 'fulfilled')) enviados++;
    else falhas++;
  }

  return Response.json({ enviado: true, dataAlvo, candidatos: candidatos.length, enviados, falhas, pulados });
});
