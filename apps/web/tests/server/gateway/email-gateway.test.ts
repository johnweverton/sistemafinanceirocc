// Teste do texto da mensagem de boleto (GATE do dono, 2026-08-04): a mensagem sempre assina
// como "Carmem Cavalcante Contabilidade", saudação usa "Dr(a). {nome}" e inclui a data de
// vencimento formatada em DD/MM/AAAA. Substitui a regra anterior da Story 7.2 (assinar pela
// conta emissora MC/Cavalcante Viana) — decisão consciente do dono, não regressão.
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
import { saudacaoPagador, montarLegendaWhatsapp, formatarDataBR } from '@/server/gateway/mensagem-boleto';

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

describe('EmailGateway.enviarBoleto — sempre assina Carmem Cavalcante Contabilidade', () => {
  it('inclui saudação, vencimento formatado e assinatura fixa, independente de qual conta emitiu', async () => {
    await new EmailGateway().enviarBoleto('medico@x.com', 'Dr(a). Fulano de Tal', '2026-08-15', 'https://pdf/x');
    const mail = mockSendMail.mock.calls[0]![0] as { from: string; subject: string; html: string };
    expect(mail.from).toContain('"Carmem Cavalcante Contabilidade"');
    expect(mail.subject).toContain('Carmem Cavalcante Contabilidade');
    expect(mail.html).toContain('Carmem Cavalcante Contabilidade');
    expect(mail.html).toContain('Dr(a). Fulano de Tal');
    expect(mail.html).toContain('15/08/2026');
  });
});

describe('saudacaoPagador (mensagem-boleto.ts)', () => {
  it('médico (PF) → "Dr(a). {nome}"', () => {
    expect(saudacaoPagador({ pagadorTipo: 'PF', pagadorNome: 'John Weverton' })).toBe('Dr(a). John Weverton');
  });
  it('empresa/cliente contábil (PJ) → só o nome/razão social, sem "Dr."', () => {
    expect(saudacaoPagador({ pagadorTipo: 'PJ', pagadorNome: 'Clínica XYZ Ltda' })).toBe('Clínica XYZ Ltda');
  });
});

describe('formatarDataBR (mensagem-boleto.ts)', () => {
  it('AAAA-MM-DD → DD/MM/AAAA', () => {
    expect(formatarDataBR('2026-08-15')).toBe('15/08/2026');
  });
});

describe('montarLegendaWhatsapp (mensagem-boleto.ts)', () => {
  it('monta a legenda com saudação, vencimento e assinatura, no formato pedido pelo dono', () => {
    const legenda = montarLegendaWhatsapp({ pagadorTipo: 'PF', pagadorNome: 'John Weverton' }, '2026-08-15');
    expect(legenda).toBe(
      'Olá, Dr(a). John Weverton!\n' +
        'Segue abaixo o boleto da cobrança médica com o vencimento para 15/08/2026.\n\n' +
        'At.te\nCarmem Cavalcante Contabilidade',
    );
  });
});
