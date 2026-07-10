// Testes do contaEmissora nos schemas de médico (QA-711-2, Story 7.1):
// atualizarMedicoSchema é .strict() — sem o campo declarado, updates com contaEmissora
// seriam rejeitados com 400 e a UI da 7.3 não teria como classificar médicos.
import { describe, it, expect } from 'vitest';
import { novoMedicoSchema, atualizarMedicoSchema } from '@/server/validation/medico-schema';

const novoBase = {
  cpf: '00000000001',
  nome: 'Dra. A',
  statusHapvida: 'credenciado' as const,
};

describe('contaEmissora nos schemas de médico', () => {
  it('novoMedicoSchema aceita mc e cavalcante_viana', () => {
    expect(novoMedicoSchema.parse({ ...novoBase, contaEmissora: 'mc' }).contaEmissora).toBe('mc');
    expect(
      novoMedicoSchema.parse({ ...novoBase, contaEmissora: 'cavalcante_viana' }).contaEmissora,
    ).toBe('cavalcante_viana');
  });

  it('novoMedicoSchema sem o campo → undefined (default fica no banco: mc)', () => {
    expect(novoMedicoSchema.parse(novoBase).contaEmissora).toBeUndefined();
  });

  it('valor inválido é rejeitado (espelho da CHECK 0021)', () => {
    expect(() => novoMedicoSchema.parse({ ...novoBase, contaEmissora: 'itau' })).toThrow();
    expect(() =>
      atualizarMedicoSchema.parse({ contaEmissora: 'itau', motivo: 'troca de banco' }),
    ).toThrow();
  });

  it('atualizarMedicoSchema (.strict()) aceita o campo — update de classificação funciona', () => {
    const out = atualizarMedicoSchema.parse({
      contaEmissora: 'cavalcante_viana',
      motivo: 'médico cobrado pela Cavalcante Viana',
    });
    expect(out.contaEmissora).toBe('cavalcante_viana');
  });
});
