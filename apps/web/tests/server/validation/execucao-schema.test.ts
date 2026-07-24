// Validação Zod do payload de disparo de execução — Story 10.2 adiciona os campos opcionais
// de produção de consultas (pediatria), sem tornar a seleção normal mais restritiva.
import { describe, it, expect } from 'vitest';
import { dispararExecucaoSchema } from '../../../src/server/validation/execucao-schema';

const selecaoBase = {
  medicoId: '11111111-1111-1111-1111-111111111111',
  producaoExternaId: 'p-guias',
  producaoNome: 'Junho 2026',
};

describe('dispararExecucaoSchema — produção de consultas (Story 10.2)', () => {
  it('seleção sem os campos de consulta continua válida (regressão)', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [selecaoBase],
    });
    expect(r.success).toBe(true);
  });

  it('seleção com produção de consultas válida passa', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [
        {
          ...selecaoBase,
          producaoConsultasExternaId: 'p-consultas',
          producaoConsultasNome: 'Consultas Junho 2026',
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('producaoConsultasExternaId null explícito é aceito (sem componente de consultas)', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecaoBase, producaoConsultasExternaId: null, producaoConsultasNome: null }],
    });
    expect(r.success).toBe(true);
  });

  it('producaoConsultasExternaId vazio ("") é rejeitado — mesma regra da produção principal', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecaoBase, producaoConsultasExternaId: '' }],
    });
    expect(r.success).toBe(false);
  });

  it('competência ainda é obrigatória e no formato AAAA-MM', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '06-2026',
      selecoes: [selecaoBase],
    });
    expect(r.success).toBe(false);
  });
});

describe('dispararExecucaoSchema — cliente contábil (Story 11.3)', () => {
  const clienteId = '22222222-2222-2222-2222-222222222222';

  it('selecoes vazio + clienteContabilidadeId passa (cliente contábil não tem médicos)', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [],
      clienteContabilidadeId: clienteId,
    });
    expect(r.success).toBe(true);
  });

  it('selecoes ausente (default []) + clienteContabilidadeId passa', () => {
    const r = dispararExecucaoSchema.safeParse({ competencia: '2026-07', clienteContabilidadeId: clienteId });
    expect(r.success).toBe(true);
  });

  it('selecoes vazio SEM clienteContabilidadeId (nem empresaId) → rejeita', () => {
    const r = dispararExecucaoSchema.safeParse({ competencia: '2026-07', selecoes: [] });
    expect(r.success).toBe(false);
  });

  it('empresaId e clienteContabilidadeId juntos → rejeita', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [],
      empresaId: '33333333-3333-3333-3333-333333333333',
      clienteContabilidadeId: clienteId,
    });
    expect(r.success).toBe(false);
  });
});

describe('dispararExecucaoSchema — adicional semestral (Story 11.4)', () => {
  const clienteId = '22222222-2222-2222-2222-222222222222';

  it('ehAdicional true + clienteContabilidadeId passa', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      clienteContabilidadeId: clienteId,
      ehAdicional: true,
    });
    expect(r.success).toBe(true);
  });

  it('ehAdicional true SEM clienteContabilidadeId → rejeita', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [{ medicoId: clienteId, producaoExternaId: 'p1', producaoNome: 'P' }],
      ehAdicional: true,
    });
    expect(r.success).toBe(false);
  });
});
