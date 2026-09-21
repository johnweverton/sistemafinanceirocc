// Validação Zod de config_relatorio_mensal — destinatários e dia de envio do relatório
// mensal automático (cron), editáveis em Configurações.
import { z } from 'zod';

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function listaEmails(valor: string): string[] {
  return valor.split(',').map((e) => e.trim()).filter(Boolean);
}

export const configRelatorioMensalSchema = z
  .object({
    emails: z
      .string()
      .refine((v) => listaEmails(v).every((e) => EMAIL_REGEX.test(e)), 'E-mails inválidos — separe por vírgula'),
    // 28 (não 31): todo mês tem pelo menos 28 dias, evita "dia 31" sumir em meses curtos.
    diaEnvio: z.number().int().min(1).max(28),
    habilitado: z.boolean(),
  })
  .refine((c) => !c.habilitado || listaEmails(c.emails).length > 0, {
    message: 'Informe ao menos um e-mail para habilitar o envio',
    path: ['emails'],
  });
