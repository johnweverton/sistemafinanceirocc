import nodemailer from 'nodemailer';
import { getServerEnv } from '@/lib/env';
import { NOME_REMETENTE_MENSAGEM, formatarDataBR } from './mensagem-boleto';

export class EmailGateway {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const env = getServerEnv();
    
    // Só inicializa o transporter se o ambiente tiver as variáveis configuradas
    if (env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465, // true para 465, false para outras portas
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
    } else {
      console.warn('⚠️ SMTP credentials not fully configured. EmailGateway will run in mock mode.');
    }
  }

  /**
   * Baixa o PDF do boleto para a memória.
   */
  private async downloadPdf(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falha ao baixar o PDF do boleto da URL: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Envia o boleto com o PDF em anexo e um link de backup.
   * GATE do dono (2026-08-04): a mensagem sempre assina como Carmem Cavalcante Contabilidade,
   * independente da conta emissora real do boleto (MC/Cavalcante Viana) — mudança consciente
   * da regra original da Story 7.2 (ver mensagem-boleto.ts). `saudacao` já vem pronta do
   * chamador (com "Dr(a)." se for médico PF, ver `saudacaoPagador`).
   */
  async enviarBoleto(paraEmail: string, saudacao: string, vencimento: string, pdfUrl: string) {
    if (!this.transporter) {
      console.log(`[Mock Email] Simulando envio de boleto para ${paraEmail} (Anexo URL: ${pdfUrl})`);
      return;
    }

    try {
      const pdfBuffer = await this.downloadPdf(pdfUrl);
      const env = getServerEnv();
      const remetente = env.SMTP_USER || 'contato@empresa.com.br';
      // Boleto híbrido (achado 2026-08-05): só menciona Pix se o boleto foi de fato emitido com
      // a opção — mencionar sem a opção existir no PDF confundiria o pagador.
      const pixDisponivel = env.EMISSAO_PIX_HABILITADA === 'true';

      const html = `
        <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #171717; padding: 24px; text-align: center;">
             <h1 style="color: #fff; margin: 0; font-size: 20px;">${NOME_REMETENTE_MENSAGEM}</h1>
          </div>
          <div style="padding: 32px 24px;">
            <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${saudacao}</strong>!</p>
            <p>Segue abaixo o boleto da cobrança médica com o vencimento para <strong>${formatarDataBR(vencimento)}</strong>. O PDF vai em anexo neste e-mail.</p>
            ${pixDisponivel ? '<p>Você também pode pagar via Pix escaneando o QR Code no boleto.</p>' : ''}
            <p>Se preferir, você também pode visualizar e imprimir o boleto através do link seguro abaixo:</p>

            <div style="margin: 32px 0;">
              <a href="${pdfUrl}" target="_blank" style="background-color: #0A0A0A; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">Acessar Boleto Online</a>
            </div>

            <p style="color: #666; font-size: 14px; margin-bottom: 0;">
              Caso o boleto já tenha sido pago, por favor desconsidere esta mensagem.
            </p>
          </div>
          <div style="background-color: #f9f9f9; padding: 16px 24px; text-align: center; color: #888; font-size: 12px; border-top: 1px solid #eaeaea;">
            At.te, ${NOME_REMETENTE_MENSAGEM}. Este é um e-mail automático, por favor não responda.
          </div>
        </div>
      `;

      const info = await this.transporter.sendMail({
        from: `"${NOME_REMETENTE_MENSAGEM}" <${remetente}>`,
        to: paraEmail,
        subject: `Seu Boleto - ${NOME_REMETENTE_MENSAGEM}`,
        html,
        attachments: [
          {
            filename: 'boleto.pdf',
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });

      console.log(`[EmailGateway] E-mail enviado com sucesso: ${info.messageId}`);
      return info;
    } catch (error) {
      console.error(`[EmailGateway] Erro ao enviar e-mail para ${paraEmail}:`, error);
      throw error;
    }
  }
}
