// Validação Zod da regra de preço própria (Story 10.1) — espelho das CHECKs 0025/0027:
// modo preco_proprio exige regraPreco; por_guia exige taxa; base_excedente exige
// base+limiar+taxa; fixo exige valorFixo.
import { describe, it, expect } from 'vitest';
import { novoMedicoSchema, atualizarMedicoSchema } from '../../../src/server/validation/medico-schema';

const basePayload = {
  cpf: '11122233344',
  nome: 'Dr. Teste',
  statusHapvida: 'credenciado' as const,
};

describe('novoMedicoSchema — regraPreco (Story 10.1)', () => {
  it('default: faixa_guias sem regraPreco passa', () => {
    const r = novoMedicoSchema.parse(basePayload);
    expect(r.modoCobranca).toBe('faixa_guias');
    expect(r.regraPreco).toBeNull();
  });

  it('preco_proprio com forma por_guia completa passa (Dr. Ezequiel)', () => {
    const r = novoMedicoSchema.parse({
      ...basePayload,
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'por_guia', taxa: 4.0 },
    });
    expect(r.regraPreco).toMatchObject({ forma: 'por_guia', taxa: 4.0 });
  });

  it('por_guia sem taxa → rejeita', () => {
    const r = novoMedicoSchema.safeParse({
      ...basePayload,
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'por_guia' },
    });
    expect(r.success).toBe(false);
  });

  it('preco_proprio com forma base_excedente completa passa', () => {
    const r = novoMedicoSchema.parse({
      ...basePayload,
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'base_excedente', base: 935.62, limiar: 144, taxa: 6.5 },
    });
    expect(r.regraPreco).toMatchObject({ forma: 'base_excedente', base: 935.62, limiar: 144, taxa: 6.5 });
  });

  it('preco_proprio com forma fixo completa passa', () => {
    const r = novoMedicoSchema.parse({
      ...basePayload,
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'fixo', valorFixo: 591.22 },
    });
    expect(r.regraPreco).toMatchObject({ forma: 'fixo', valorFixo: 591.22 });
  });

  it('preco_proprio SEM regraPreco → rejeita (espelho da CHECK 0025)', () => {
    const r = novoMedicoSchema.safeParse({ ...basePayload, modoCobranca: 'preco_proprio' });
    expect(r.success).toBe(false);
  });

  it('base_excedente sem taxa → rejeita', () => {
    const r = novoMedicoSchema.safeParse({
      ...basePayload,
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'base_excedente', base: 935.62, limiar: 144 },
    });
    expect(r.success).toBe(false);
  });

  it('fixo sem valorFixo → rejeita', () => {
    const r = novoMedicoSchema.safeParse({
      ...basePayload,
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'fixo' },
    });
    expect(r.success).toBe(false);
  });

  it('valores negativos → rejeita', () => {
    const r = novoMedicoSchema.safeParse({
      ...basePayload,
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'fixo', valorFixo: -10 },
    });
    expect(r.success).toBe(false);
  });
});

describe('atualizarMedicoSchema — regraPreco (Story 10.1)', () => {
  it('mudar para preco_proprio junto com a regra passa', () => {
    const r = atualizarMedicoSchema.safeParse({
      modoCobranca: 'preco_proprio',
      regraPreco: { forma: 'fixo', valorFixo: 130.53 },
      motivo: 'Override negociado — planilha da coordenação',
    });
    expect(r.success).toBe(true);
  });

  it('mudar para preco_proprio SEM enviar a regra → rejeita', () => {
    const r = atualizarMedicoSchema.safeParse({
      modoCobranca: 'preco_proprio',
      motivo: 'Override negociado',
    });
    expect(r.success).toBe(false);
  });

  it('update que não toca no modo (ex.: só nome) segue passando', () => {
    const r = atualizarMedicoSchema.safeParse({ nome: 'Novo Nome', motivo: 'Correção de nome' });
    expect(r.success).toBe(true);
  });

  it('remover o override (regraPreco: null) sem mudar o modo passa', () => {
    const r = atualizarMedicoSchema.safeParse({
      regraPreco: null,
      motivo: 'Removendo override antigo',
    });
    expect(r.success).toBe(true);
  });
});
