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
