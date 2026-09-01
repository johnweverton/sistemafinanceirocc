import nodemailer from 'nodemailer';
import { getServerEnv } from '@/lib/env';
import { brl } from '@/lib/formato';
import {
  NOME_REMETENTE_MENSAGEM,
  formatarDataBR,
  descricaoServico,
  assuntoLembreteVencimentoEmail,
  type PagadorNomenclatura,
} from './mensagem-boleto';

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
   * chamador (com "Dr(a)." se for médico PF, ver `saudacaoPagador`). `pagadorNomenclatura`
   * decide entre "cobrança médica" e "honorários contábeis" no corpo (achado 2026-08-27: cliente
   * contábil não deve receber o texto de cobrança médica).
   */
  async enviarBoleto(paraEmail: string, saudacao: string, vencimento: string, pdfUrl: string, pagadorNomenclatura: PagadorNomenclatura) {
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
            <p>Segue abaixo o boleto ${descricaoServico(pagadorNomenclatura)} com o vencimento para <strong>${formatarDataBR(vencimento)}</strong>. O PDF vai em anexo neste e-mail.</p>
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

  /**
   * Lembrete PREVENTIVO de vencimento (D-1, Épico 13 Fase 1, cron) — texto e assunto diferentes
   * de `enviarBoleto` ("segue o boleto" seria confuso para um boleto já enviado antes). Método
   * separado em vez de parametrizar `enviarBoleto` (menor risco de regressão no fluxo de emissão
   * real já em produção). Mesmo modo mock (sem transporter configurado, só loga e não lança).
   */
  async enviarLembreteVencimento(paraEmail: string, saudacao: string, vencimento: string, pdfUrl: string, pagadorNomenclatura: PagadorNomenclatura) {
    if (!this.transporter) {
      console.log(`[Mock Email] Simulando envio de lembrete de vencimento para ${paraEmail} (Anexo URL: ${pdfUrl})`);
      return;
    }

    try {
      const pdfBuffer = await this.downloadPdf(pdfUrl);
      const env = getServerEnv();
      const remetente = env.SMTP_USER || 'contato@empresa.com.br';

      const html = `
        <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #171717; padding: 24px; text-align: center;">
             <h1 style="color: #fff; margin: 0; font-size: 20px;">${NOME_REMETENTE_MENSAGEM}</h1>
          </div>
          <div style="padding: 32px 24px;">
            <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${saudacao}</strong>!</p>
            <p>Passando para lembrar que o boleto ${descricaoServico(pagadorNomenclatura)} vence amanhã, <strong>${formatarDataBR(vencimento)}</strong>. O PDF vai em anexo neste e-mail.</p>
            <p>Se preferir, você também pode visualizar e imprimir o boleto através do link seguro abaixo:</p>

            <div style="margin: 32px 0;">
              <a href="${pdfUrl}" target="_blank" style="background-color: #0A0A0A; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">Acessar Boleto Online</a>
            </div>

            <p style="color: #666; font-size: 14px; margin-bottom: 0;">
              Se já efetuou o pagamento, por favor desconsidere esta mensagem.
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
        subject: assuntoLembreteVencimentoEmail(vencimento),
        html,
        attachments: [
          {
            filename: 'boleto.pdf',
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });

      console.log(`[EmailGateway] Lembrete de vencimento enviado com sucesso: ${info.messageId}`);
      return info;
    } catch (error) {
      console.error(`[EmailGateway] Erro ao enviar lembrete de vencimento para ${paraEmail}:`, error);
      throw error;
    }
  }

  /**
   * Relatório mensal automático (cron, feedback do dono 2026-08-17): PDF do fechamento do mês
   * anterior, já gerado por quem chama (gerarRelatorioRecebiveisPdf) — este método só envia.
   * Mesmo modo mock de enviarBoleto: sem transporter configurado, só loga e não lança.
   */
  async enviarRelatorioMensal(
    paraEmails: string[],
    competencia: string,
    pdfBuffer: Buffer,
    resumo: { totalEmitido: number; totalPago: number; totalVencido: number },
  ) {
    if (!this.transporter) {
      console.log(`[Mock Email] Simulando envio do relatório mensal (${competencia}) para ${paraEmails.join(', ')}`);
      return;
    }

    const remetente = getServerEnv().SMTP_USER || 'contato@empresa.com.br';

    const html = `
      <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #171717; padding: 24px; text-align: center;">
           <h1 style="color: #fff; margin: 0; font-size: 20px;">${NOME_REMETENTE_MENSAGEM}</h1>
        </div>
        <div style="padding: 32px 24px;">
          <p style="font-size: 16px; margin-top: 0;">Relatório mensal de recebíveis — competência <strong>${competencia}</strong>.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px 0; color: #666;">Emitido</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${brl(resumo.totalEmitido)}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Recebido</td><td style="padding: 6px 0; text-align: right; font-weight: bold; color: #059669;">${brl(resumo.totalPago)}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Vencido</td><td style="padding: 6px 0; text-align: right; font-weight: bold; color: #D97706;">${brl(resumo.totalVencido)}</td></tr>
          </table>
          <p>O detalhamento completo, agrupado por empresa, está no PDF em anexo.</p>
        </div>
        <div style="background-color: #f9f9f9; padding: 16px 24px; text-align: center; color: #888; font-size: 12px; border-top: 1px solid #eaeaea;">
          At.te, ${NOME_REMETENTE_MENSAGEM}. Este é um e-mail automático, por favor não responda.
        </div>
      </div>
    `;

    try {
      const info = await this.transporter.sendMail({
        from: `"${NOME_REMETENTE_MENSAGEM}" <${remetente}>`,
        to: paraEmails.join(', '),
        subject: `Relatório Mensal de Recebíveis — ${competencia}`,
        html,
        attachments: [
          { filename: `relatorio-${competencia}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
        ],
      });
      console.log(`[EmailGateway] Relatório mensal enviado: ${info.messageId}`);
      return info;
    } catch (error) {
      console.error('[EmailGateway] Erro ao enviar relatório mensal:', error);
      throw error;
    }
  }
}
