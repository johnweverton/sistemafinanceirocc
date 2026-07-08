// Validação Zod do modo de cobrança (Story 6.2) — espelho da CHECK 0018:
// modo percentual exige percentualProducao > 0; modo faixas não exige nada.
import { describe, it, expect } from 'vitest';
import { novoMedicoSchema, atualizarMedicoSchema } from '../../../src/server/validation/medico-schema';

const basePayload = {
  cpf: '11122233344',
  nome: 'Dr. Teste',
  statusHapvida: 'credenciado' as const,
};

describe('novoMedicoSchema — modoCobranca (Story 6.2)', () => {
  it('default: faixa_guias sem percentual passa', () => {
    const r = novoMedicoSchema.parse(basePayload);
    expect(r.modoCobranca).toBe('faixa_guias');
    expect(r.percentualProducao).toBeNull();
  });

  it('percentual_producao com percentual > 0 passa', () => {
    const r = novoMedicoSchema.parse({
      ...basePayload,
      modoCobranca: 'percentual_producao',
      percentualProducao: 5,
    });
    expect(r.percentualProducao).toBe(5);
  });

  it('percentual_producao SEM percentual → rejeita (espelho da CHECK 0018)', () => {
    const r = novoMedicoSchema.safeParse({ ...basePayload, modoCobranca: 'percentual_producao' });
    expect(r.success).toBe(false);
  });

  it('percentual fora do range (0 ou > 100) → rejeita', () => {
    expect(
      novoMedicoSchema.safeParse({
        ...basePayload, modoCobranca: 'percentual_producao', percentualProducao: 0,
      }).success,
    ).toBe(false);
    expect(
      novoMedicoSchema.safeParse({
        ...basePayload, modoCobranca: 'percentual_producao', percentualProducao: 101,
      }).success,
    ).toBe(false);
  });
});

describe('atualizarMedicoSchema — modoCobranca (Story 6.2)', () => {
  it('mudar para percentual junto com o percentual passa', () => {
    const r = atualizarMedicoSchema.safeParse({
      modoCobranca: 'percentual_producao',
      percentualProducao: 7.5,
      motivo: 'Médico auxiliar — regra da Carmem',
    });
    expect(r.success).toBe(true);
  });

  it('mudar para percentual SEM enviar o percentual → rejeita', () => {
    const r = atualizarMedicoSchema.safeParse({
      modoCobranca: 'percentual_producao',
      motivo: 'Médico auxiliar',
    });
    expect(r.success).toBe(false);
  });

  it('update que não toca no modo (ex.: só nome) segue passando', () => {
    const r = atualizarMedicoSchema.safeParse({ nome: 'Novo Nome', motivo: 'Correção de nome' });
    expect(r.success).toBe(true);
  });
});
