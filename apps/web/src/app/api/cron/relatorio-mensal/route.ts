// GET /api/cron/relatorio-mensal — dispara automaticamente pelo Vercel Cron (vercel.json, dia 1
// de cada mês) e manda o PDF do fechamento do mês ANTERIOR pra CEO por e-mail, sem ela precisar
// abrir o sistema (feedback do dono, 2026-08-17). Zero peça nova de infraestrutura: reusa
// listarRecebiveis + agruparRecebiveisPorEmpresa + gerarRelatorioRecebiveisPdf (já existentes no
// Módulo de Relatórios) e o EmailGateway (já configurado pro SMTP de disparo de boleto).
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

  // RELATORIO_MENSAL_EMAILS vazio/ausente não é erro — é "feature desligada até alguém
  // configurar o destinatário", mesmo espírito do modo mock do EmailGateway.
  const destinatarios = (env.RELATORIO_MENSAL_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (destinatarios.length === 0) {
    console.warn(
      `[cron/relatorio-mensal] RELATORIO_MENSAL_EMAILS não configurado — pulando envio (competência ${competencia}).`,
    );
    return Response.json({ enviado: false, motivo: 'RELATORIO_MENSAL_EMAILS não configurado', competencia });
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
