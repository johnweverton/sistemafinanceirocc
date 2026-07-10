// Teste do remetente por conta emissora (Story 7.2, AC 6): o e-mail que entrega o boleto
// deve sair assinado pela EMPRESA que emitiu (MC / Cavalcante Viana) — nunca um nome fixo.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(() => ({
    SMTP_HOST: 'smtp.test',
    SMTP_PORT: 587,
    SMTP_USER: 'cobranca@test.com',
    SMTP_PASS: 'x',
  })),
}));

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

import { EmailGateway } from '@/server/gateway/email-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  // downloadPdf usa fetch global — devolve um PDF fake.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }),
  );
});

describe('EmailGateway.enviarBoleto — remetente por conta emissora', () => {
  it('conta mc → from/subject/corpo assinados como "MC"', async () => {
    await new EmailGateway().enviarBoleto('medico@x.com', 'Dr. Teste', 'https://pdf/x', 'mc');
    const mail = mockSendMail.mock.calls[0]![0] as { from: string; subject: string; html: string };
    expect(mail.from).toContain('"MC"');
    expect(mail.subject).toContain('MC');
    expect(mail.html).toContain('MC');
  });

  it('conta cavalcante_viana → assinada como "Cavalcante Viana" (nunca nome fixo)', async () => {
    await new EmailGateway().enviarBoleto('medico@x.com', 'Dr. Teste', 'https://pdf/x', 'cavalcante_viana');
    const mail = mockSendMail.mock.calls[0]![0] as { from: string; subject: string; html: string };
    expect(mail.from).toContain('"Cavalcante Viana"');
    expect(mail.subject).toContain('Cavalcante Viana');
    expect(mail.html).toContain('Cavalcante Viana');
    expect(mail.from).not.toContain('Carmem Contabilidade');
  });
});
