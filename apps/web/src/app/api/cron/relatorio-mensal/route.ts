// GET /api/cron/relatorio-mensal — dispara automaticamente pelo Vercel Cron (vercel.json, TODO
// DIA às 12h UTC — o Vercel Cron não tem "dia configurável em runtime", então quem decide se hoje
// é o dia certo é esta rota, lendo config_relatorio_mensal) e manda o PDF do fechamento do mês
// ANTERIOR pra CEO por e-mail, sem ela precisar abrir o sistema (feedback do dono, 2026-08-17).
// Destinatários e dia de envio são editáveis em Configurações (config-relatorio-mensal-repository).
// Zero peça nova de infraestrutura: reusa listarRecebiveis + agruparRecebiveisPorEmpresa +
// gerarRelatorioRecebiveisPdf (já existentes no Módulo de Relatórios) e o EmailGateway (já
// configurado pro SMTP de disparo de boleto).
//
// Sem sessão de usuário (o Vercel Cron não autentica como alguém logado) — autenticação é só o
// segredo compartilhado, mesmo padrão de tempo constante do webhook da Cora
// (api/webhooks/cora/[secret]/route.ts). Sem CRON_SECRET configurado, a rota fica sempre
// bloqueada (fail-closed) — nunca "aberta por omissão".
import { timingSafeEqual } from 'node:crypto';
import { withErrorHandler, ApiError } from '@/lib/api-error';
import { getServerEnv } from '@/lib/env';
import { competenciaAnterior } from '@/lib/competencia';
import { listarRecebiveis } from '@/server/repositories/recebiveis-repository';
import { agruparRecebiveisPorEmpresa } from '@/server/engine/relatorio-recebiveis';
import { gerarRelatorioRecebiveisPdf } from '@/server/engine/relatorio-recebiveis-pdf';
import { EmailGateway } from '@/server/gateway/email-gateway';
import { lerConfig as lerConfigRelatorioMensal } from '@/server/repositories/config-relatorio-mensal-repository';

function segredosBatem(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const GET = withErrorHandler(async (req) => {
  const env = getServerEnv();
  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined;
  if (!env.CRON_SECRET || !segredosBatem(bearer, env.CRON_SECRET)) {
    throw new ApiError(401, 'Segredo de cron inválido ou não configurado', 'UNAUTHORIZED');
  }

  const competencia = competenciaAnterior();

  // Config vem de config_relatorio_mensal (editável em Configurações). Enquanto ninguém salvar
  // pela tela (linha ainda no estado seed: desabilitado e sem e-mails), cai no fallback legado
  // RELATORIO_MENSAL_EMAILS + dia 1 — preserva quem já tinha isso configurado só via env var
  // antes desta tela existir.
  const configDb = await lerConfigRelatorioMensal();
  const configNuncaTocada = !configDb.habilitado && configDb.emails.trim() === '';
  const habilitado = configNuncaTocada ? Boolean(env.RELATORIO_MENSAL_EMAILS) : configDb.habilitado;
  const diaEnvio = configNuncaTocada ? 1 : configDb.diaEnvio;
  const emailsRaw = configNuncaTocada ? (env.RELATORIO_MENSAL_EMAILS ?? '') : configDb.emails;

  if (!habilitado) {
    console.warn(`[cron/relatorio-mensal] Envio desabilitado — pulando (competência ${competencia}).`);
    return Response.json({ enviado: false, motivo: 'Envio desabilitado', competencia });
  }

  // Dia lido em UTC (mesmo fuso do cron, ver competenciaAnterior acima).
  const hojeUTC = new Date().getUTCDate();
  if (hojeUTC !== diaEnvio) {
    return Response.json({
      enviado: false,
      motivo: `Hoje (dia ${hojeUTC}) não é o dia configurado para envio (dia ${diaEnvio})`,
      competencia,
    });
  }

  const destinatarios = emailsRaw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (destinatarios.length === 0) {
    console.warn(
      `[cron/relatorio-mensal] Nenhum destinatário configurado — pulando envio (competência ${competencia}).`,
    );
    return Response.json({ enviado: false, motivo: 'Nenhum destinatário configurado', competencia });
  }

  const recebiveis = await listarRecebiveis({ competencia });
  const relatorio = agruparRecebiveisPorEmpresa(recebiveis, { competencia });
  const pdf = await gerarRelatorioRecebiveisPdf(relatorio, null);

  await new EmailGateway().enviarRelatorioMensal(destinatarios, competencia, pdf, relatorio.totalGeral);

  return Response.json({
    enviado: true,
    competencia,
    destinatarios: destinatarios.length,
    totalGeral: relatorio.totalGeral,
  });
});
