// Validação Zod de config_relatorio_mensal — destinatários e dia de envio do relatório mensal.
import { describe, it, expect } from 'vitest';
import { configRelatorioMensalSchema } from '../../../src/server/validation/config-relatorio-mensal-schema';

describe('configRelatorioMensalSchema', () => {
  it('emails válidos + dia dentro da faixa → passa', () => {
    const r = configRelatorioMensalSchema.safeParse({
      emails: 'ceo@empresa.com, financeiro@empresa.com',
      diaEnvio: 5,
      habilitado: true,
    });
    expect(r.success).toBe(true);
  });

  it('habilitado=false com emails vazio → passa (estado desligado)', () => {
    const r = configRelatorioMensalSchema.safeParse({ emails: '', diaEnvio: 1, habilitado: false });
    expect(r.success).toBe(true);
  });

  it('habilitado=true com emails vazio → rejeita', () => {
    const r = configRelatorioMensalSchema.safeParse({ emails: '', diaEnvio: 1, habilitado: true });
    expect(r.success).toBe(false);
  });

  it('e-mail mal formatado → rejeita', () => {
    const r = configRelatorioMensalSchema.safeParse({ emails: 'nao-e-email', diaEnvio: 1, habilitado: true });
    expect(r.success).toBe(false);
  });

  it('diaEnvio fora de 1–28 → rejeita', () => {
    expect(configRelatorioMensalSchema.safeParse({ emails: 'a@b.com', diaEnvio: 0, habilitado: true }).success).toBe(false);
    expect(configRelatorioMensalSchema.safeParse({ emails: 'a@b.com', diaEnvio: 29, habilitado: true }).success).toBe(false);
  });
});
