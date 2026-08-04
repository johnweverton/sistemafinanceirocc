// Script de diagnóstico (não automático): valida os disparos de WhatsApp (Zappy) e e-mail (SMTP)
// usando um PDF de boleto JÁ EXISTENTE (ex.: o link retornado por um boleto real emitido e depois
// cancelado). NÃO emite boleto nenhum, NÃO grava nada no banco — só testa as duas integrações de
// notificação isoladamente, replicando a mesma lógica de zappy-gateway.ts e email-gateway.ts.
//
// Uso:
//   npx tsx scripts/testar-disparo.ts --pdf "https://...boleto.pdf" --whatsapp "5585999999999" --email "voce@exemplo.com" --nome "John Weverton" --vencimento "2026-08-15" [--pj]
//
// Requer um .env.production na raiz (mesmo padrão de scripts/check-boleto.ts) com:
//   ZAPPY_API_URL, ZAPPY_API_TOKEN, ZAPPY_CONNECTION_ID, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
import * as fs from 'fs';
import nodemailer from 'nodemailer';

// Mesmo texto/regras de src/server/gateway/mensagem-boleto.ts (GATE do dono, 2026-08-04) —
// duplicado aqui de propósito, mesmo espírito do resto do script ("replicando a mesma lógica").
const NOME_REMETENTE_MENSAGEM = 'Carmem Cavalcante Contabilidade';
function saudacaoPagador(nome: string, pj: boolean): string {
  return pj ? nome : `Dr(a). ${nome}`;
}
function formatarDataBR(isoDate: string): string {
  const [ano, mes, dia] = isoDate.split('-');
  return `${dia}/${mes}/${ano}`;
}
function montarLegendaWhatsapp(nome: string, pj: boolean, vencimento: string): string {
  return (
    `Olá, ${saudacaoPagador(nome, pj)}!\n` +
    `Segue abaixo o boleto da cobrança médica com o vencimento para ${formatarDataBR(vencimento)}.\n\n` +
    `At.te\n${NOME_REMETENTE_MENSAGEM}`
  );
}

const envStr = fs.readFileSync('.env.production', 'utf-8');
const env = Object.fromEntries(
  envStr
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1).replace(/^"|"$/g, '')];
    }),
);

function argValor(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdfUrl = argValor('pdf');
const whatsapp = argValor('whatsapp');
const email = argValor('email');
const nome = argValor('nome') ?? 'Cliente Teste';
const vencimento = argValor('vencimento') ?? new Date().toISOString().slice(0, 10);
const pj = process.argv.includes('--pj');

if (!pdfUrl) {
  console.error('Faltou --pdf "<url do PDF do boleto>"');
  process.exit(1);
}
if (!whatsapp && !email) {
  console.error('Informe pelo menos --whatsapp ou --email para testar.');
  process.exit(1);
}

function normalizarNumero(to: string): string {
  const digitos = to.replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

async function testarWhatsapp() {
  if (!whatsapp) return;
  console.log(`\n[WhatsApp] Testando envio para ${whatsapp}...`);

  if (!env.ZAPPY_API_URL || !env.ZAPPY_API_TOKEN || !env.ZAPPY_CONNECTION_ID) {
    console.error('[WhatsApp] ZAPPY_API_URL, ZAPPY_API_TOKEN ou ZAPPY_CONNECTION_ID ausentes no .env.production.');
    return;
  }

  const download = await fetch(pdfUrl!);
  if (!download.ok) {
    console.error(`[WhatsApp] Falha ao baixar o PDF (${download.status}): ${pdfUrl}`);
    return;
  }
  const conteudo = await download.blob();

  const form = new FormData();
  form.set('media', conteudo, 'boleto.pdf');
  form.set('caption', montarLegendaWhatsapp(nome, pj, vencimento));
  form.set('connectionFrom', env.ZAPPY_CONNECTION_ID);

  const apiUrl = env.ZAPPY_API_URL.replace(/\/$/, '');
  const response = await fetch(`${apiUrl}/api/send/document/${normalizarNumero(whatsapp)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ZAPPY_API_TOKEN}` },
    body: form,
  });
  const texto = await response.text();
  if (!response.ok) {
    console.error(`[WhatsApp] Erro (${response.status}): ${texto.slice(0, 300)}`);
    return;
  }
  console.log('[WhatsApp] Enviado com sucesso:', texto.slice(0, 200));
}

async function testarEmail() {
  if (!email) return;
  console.log(`\n[E-mail] Testando envio para ${email}...`);

  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS) {
    console.error('[E-mail] SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS ausentes no .env.production.');
    return;
  }

  const porta = Number(env.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: porta,
    secure: porta === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  const pdfResponse = await fetch(pdfUrl!);
  if (!pdfResponse.ok) {
    console.error(`[E-mail] Falha ao baixar o PDF (${pdfResponse.status}): ${pdfUrl}`);
    return;
  }
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

  const saudacao = saudacaoPagador(nome, pj);
  const html = `
    <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #171717; padding: 24px; text-align: center;">
         <h1 style="color: #fff; margin: 0; font-size: 20px;">${NOME_REMETENTE_MENSAGEM}</h1>
      </div>
      <div style="padding: 32px 24px;">
        <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${saudacao}</strong>!</p>
        <p>Segue abaixo o boleto da cobrança médica com o vencimento para <strong>${formatarDataBR(vencimento)}</strong>. O PDF vai em anexo neste e-mail.</p>
        <p>Se preferir, você também pode visualizar e imprimir o boleto através do link seguro abaixo:</p>
        <div style="margin: 32px 0;">
          <a href="${pdfUrl}" target="_blank" style="background-color: #0A0A0A; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">Acessar Boleto Online</a>
        </div>
        <p style="color: #666; font-size: 14px; margin-bottom: 0;">Caso o boleto já tenha sido pago, por favor desconsidere esta mensagem.</p>
      </div>
      <div style="background-color: #f9f9f9; padding: 16px 24px; text-align: center; color: #888; font-size: 12px; border-top: 1px solid #eaeaea;">
        At.te, ${NOME_REMETENTE_MENSAGEM}. Este é um e-mail automático, por favor não responda.
      </div>
    </div>
  `;

  const info = await transporter.sendMail({
    from: `"${NOME_REMETENTE_MENSAGEM}" <${env.SMTP_USER}>`,
    to: email,
    subject: `Seu Boleto - ${NOME_REMETENTE_MENSAGEM}`,
    html,
    attachments: [{ filename: 'boleto.pdf', content: pdfBuffer, contentType: 'application/pdf' }],
  });
  console.log('[E-mail] Enviado com sucesso:', info.messageId);
}

async function main() {
  await Promise.allSettled([testarWhatsapp(), testarEmail()]);
  console.log('\nFim do teste.');
}

main().catch((e) => {
  console.error('Erro inesperado:', e);
  process.exit(1);
});
