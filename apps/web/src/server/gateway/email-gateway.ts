import nodemailer from 'nodemailer';
import type { ContaEmissora } from '@cobranca/shared';
import { getServerEnv } from '@/lib/env';
import { CONTAS_EMISSORAS } from './contas-emissoras';

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
   * O remetente/cabeçalho usam o nome da CONTA EMISSORA do boleto (Story 7.2, QA-711 do
   * Épico 7): o médico da Cavalcante Viana não pode receber e-mail assinado por outra
   * empresa — coerência entre beneficiário do boleto e quem fala com ele.
   */
  async enviarBoleto(paraEmail: string, nomeCliente: string, pdfUrl: string, conta: ContaEmissora) {
    const nomeEmpresa = CONTAS_EMISSORAS[conta].nomeExibicao;
    if (!this.transporter) {
      console.log(`[Mock Email] Simulando envio de boleto (${nomeEmpresa}) para ${paraEmail} (Anexo URL: ${pdfUrl})`);
      return;
    }

    try {
      const pdfBuffer = await this.downloadPdf(pdfUrl);
      const remetente = getServerEnv().SMTP_USER || 'contato@empresa.com.br';

      const html = `
        <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #171717; padding: 24px; text-align: center;">
             <h1 style="color: #fff; margin: 0; font-size: 20px;">${nomeEmpresa}</h1>
          </div>
          <div style="padding: 32px 24px;">
            <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${nomeCliente}</strong></p>
            <p>Seu boleto já está disponível e segue em <strong>anexo</strong> neste e-mail (PDF).</p>
            <p>Se preferir, você também pode visualizar e imprimir o boleto através do link seguro abaixo:</p>
            
            <div style="margin: 32px 0;">
              <a href="${pdfUrl}" target="_blank" style="background-color: #0A0A0A; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">Acessar Boleto Online</a>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-bottom: 0;">
              Caso o boleto já tenha sido pago, por favor desconsidere esta mensagem.
            </p>
          </div>
          <div style="background-color: #f9f9f9; padding: 16px 24px; text-align: center; color: #888; font-size: 12px; border-top: 1px solid #eaeaea;">
            Este é um e-mail automático. Por favor, não responda.
          </div>
        </div>
      `;

      const info = await this.transporter.sendMail({
        from: `"${nomeEmpresa}" <${remetente}>`,
        to: paraEmail,
        subject: `Seu Boleto - ${nomeEmpresa}`,
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
