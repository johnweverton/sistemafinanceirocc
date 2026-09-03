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

describe('dispararExecucaoSchema — sub-lotes de consulta de pediatria (achado 2026-08-21)', () => {
  it('producaoConsultasLoteExternaIds + producaoGuiasLoteExternaIds válidos passa (producaoExternaId null)', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [
        {
          medicoId: selecaoBase.medicoId,
          producaoExternaId: null,
          producaoNome: null,
          producaoConsultasLoteExternaIds: ['lote-consulta-1'],
          producaoConsultasLoteNomes: ['HUMBERTO CONSULTAS DE JUNHO'],
          producaoGuiasLoteExternaIds: ['lote-1q', 'lote-2q', 'lote-parecer'],
          producaoGuiasLoteNomes: ['HUMBERTO 1Q', 'HUMBERTO 2Q', 'HUMBERTO PARECER 1Q'],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('array vazio ([]) é aceito — mesma semântica de "nenhum lote selecionado" das demais categorias', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [
        {
          ...selecaoBase,
          producaoConsultasLoteExternaIds: [],
          producaoGuiasLoteExternaIds: [],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('id vazio ("") dentro do array é rejeitado — mesma regra dos demais campos de lote', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [{ ...selecaoBase, producaoConsultasLoteExternaIds: [''] }],
    });
    expect(r.success).toBe(false);
  });

  it('seleção sem os campos de sub-lote continua válida (regressão — médico sem essa estrutura)', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [selecaoBase],
    });
    expect(r.success).toBe(true);
  });
});

// Auditoria 2026-09-02: nada barrava apontar a MESMA produção como principal e como consultas —
// o motor contaria os itens 2x (uma vez como guia, uma vez como consulta ambulatorial) e o
// resultado sairia inflado sem nenhum sinal.
describe('dispararExecucaoSchema — guard de dupla contagem de consulta (auditoria 2026-09-02)', () => {
  it('mesma produção como principal E como consultas → rejeita', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [{ ...selecaoBase, producaoConsultasExternaId: selecaoBase.producaoExternaId }],
    });
    expect(r.success).toBe(false);
  });

  it('mensagem do erro explica a dupla contagem', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [{ ...selecaoBase, producaoConsultasExternaId: selecaoBase.producaoExternaId }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('contaria em dobro'))).toBe(true);
    }
  });

  it('rejeita mesmo quando só UMA das seleções do lote repete a produção', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [
        { ...selecaoBase, producaoConsultasExternaId: 'p-consultas' },
        {
          medicoId: '33333333-3333-3333-3333-333333333333',
          producaoExternaId: 'p-julho',
          producaoNome: 'Julho 2026',
          producaoConsultasExternaId: 'p-julho',
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('produções DIFERENTES continuam válidas (regressão do caso normal da Story 10.2)', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [{ ...selecaoBase, producaoConsultasExternaId: 'p-consultas' }],
    });
    expect(r.success).toBe(true);
  });

  it('producaoExternaId null + consultas preenchida não dispara o guard (Angiologista/sub-lotes)', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-07',
      selecoes: [
        {
          medicoId: selecaoBase.medicoId,
          producaoExternaId: null,
          producaoNome: null,
          producaoConsultasExternaId: 'p-consultas',
        },
      ],
    });
    expect(r.success).toBe(true);
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

// Contagem de guias conferida MANUALMENTE por planilha (migration 0058, aprovado 2026-09-03).
describe('dispararExecucaoSchema — contagem manual de guias (migration 0058)', () => {
  const selecao = {
    medicoId: '11111111-1111-1111-1111-111111111111',
    producaoExternaId: 'p-guias',
    producaoNome: 'Junho 2026',
  };

  it('total + motivo preenchidos passa', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecao, guiasManuaisTotal: 42, guiasManuaisMotivo: 'Conferencia manual do dono' }],
    });
    expect(r.success).toBe(true);
  });

  it('total SEM motivo → rejeita (o motivo é o texto do alerta de auditoria)', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecao, guiasManuaisTotal: 42 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('motivo'))).toBe(true);
    }
  });

  it('total com motivo null explícito → rejeita', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecao, guiasManuaisTotal: 42, guiasManuaisMotivo: null }],
    });
    expect(r.success).toBe(false);
  });

  it('total com motivo só de espaços → rejeita (trim antes do min(1))', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecao, guiasManuaisTotal: 42, guiasManuaisMotivo: '   ' }],
    });
    expect(r.success).toBe(false);
  });

  it('total 0 também exige motivo (0 é um número informado, não "ausente")', () => {
    const semMotivo = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecao, guiasManuaisTotal: 0 }],
    });
    expect(semMotivo.success).toBe(false);

    const comMotivo = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecao, guiasManuaisTotal: 0, guiasManuaisMotivo: 'Sem producao no mes' }],
    });
    expect(comMotivo.success).toBe(true);
  });

  it('total negativo → rejeita', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecao, guiasManuaisTotal: -1, guiasManuaisMotivo: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('motivo sozinho (sem total) não quebra — nada de contagem manual naquela seleção', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [{ ...selecao, guiasManuaisMotivo: 'anotacao solta' }],
    });
    expect(r.success).toBe(true);
  });

  it('execução MISTA: uma seleção com contagem manual e outra sem, no mesmo payload', () => {
    const r = dispararExecucaoSchema.safeParse({
      competencia: '2026-06',
      selecoes: [
        { ...selecao, guiasManuaisTotal: 42, guiasManuaisMotivo: 'Conferencia manual' },
        { ...selecao, medicoId: '33333333-3333-3333-3333-333333333333' },
      ],
    });
    expect(r.success).toBe(true);
  });
});
