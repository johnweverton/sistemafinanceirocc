// Casos de ouro do médico Angiologista (GATE 2026-08-07) — especialidade SEM lote principal: a
// produção inteira vem de Cateter (1x1), Fístula (1x1), Angiografia (3x1 + exceção
// Intra-operatório) e Carta de Rede (GATE 2026-08-12, contagem MANUAL — sem regra fixa), cuja
// soma cai na faixa HAPVIDA padrão do médico (crédito/não credenciado), sem classe/tabela de
// preço própria.
import { describe, it, expect } from 'vitest';
import type { EntradaProcessamentoMedico, ItemProducao } from '@cobranca/shared';
import { processarMedico } from '../../../src/server/engine/processar-medico';

function item(overrides: Partial<ItemProducao> & { pacienteNome: string }): ItemProducao {
  return {
    data: '2026-07-10',
    atendimentoExternoId: null,
    codigoProcedimento: '31102034',
    descricaoProcedimento: 'Procedimento vascular',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
    ...overrides,
  };
}

/** N itens, cada um de paciente distinto → sempre N guias em qualquer regra (1x1 ou 3x1 com
 *  grupos de 1). Usado pro Cateter/Fístula (1x1), onde não importa agrupamento. */
function itensAvulsos(n: number, prefixo: string): ItemProducao[] {
  return Array.from({ length: n }, (_, i) => item({ pacienteNome: `${prefixo}-${i}` }));
}

/** N itens do MESMO paciente/data → teto(n/3) guias (agrupamento 3x1). Usado pra Angiografia. */
function itensAgrupados(n: number, pacienteNome: string): ItemProducao[] {
  return Array.from({ length: n }, () => item({ pacienteNome }));
}

function angiologista(overrides: Partial<EntradaProcessamentoMedico['medico']> = {}): EntradaProcessamentoMedico['medico'] {
  return {
    id: 'angio-1',
    cpf: '33344455566',
    nome: 'Dr. Angiologista Teste',
    statusHapvida: 'credenciado',
    fazOutrosHospitais: false,
    fazImobilizacoes: false,
    modoMudancaData: 'nao',
    especialidade: 'Angiologista',
    modoCobranca: 'faixa_guias',
    percentualProducao: null,
    regraPreco: null,
    semExcedentePorGuia: false,
    ...overrides,
  };
}

describe('processarMedico — Angiologista (GATE 2026-08-07)', () => {
  it('Cateter é 1x1: 7 itens (patients distintos) → 7 guias, sem agrupamento', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensCateter: itensAvulsos(7, 'Cateter'),
    });
    expect(r.guias).toBe(7);
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_CRED', guias: 7 }),
    ]);
  });

  it('Fístula é 1x1: 5 itens → 5 guias, sem agrupamento', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensFistula: itensAvulsos(5, 'Fistula'),
    });
    expect(r.guias).toBe(5);
  });

  it('Angiografia é 3x1: 9 itens do mesmo paciente/data → teto(9/3) = 3 guias', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensAngiografia: itensAgrupados(9, 'Paciente Angio'),
    });
    expect(r.guias).toBe(3);
  });

  it('Angiografia com Intra-operatório: 1 exceção + 2 normais no mesmo grupo → 1 + teto(2/3)=1 = 2 guias', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensAngiografia: [
        item({ pacienteNome: 'P1', codigoProcedimento: '4.09.02.05-6' }),
        item({ pacienteNome: 'P1' }),
        item({ pacienteNome: 'P1' }),
      ],
    });
    expect(r.guias).toBe(2);
  });

  it('caso combinado: Cateter(4) + Fístula(3) + Angiografia(teto(6/3)=2) = 9 guias somados numa faixa só', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensCateter: itensAvulsos(4, 'Cateter'),
      itensFistula: itensAvulsos(3, 'Fistula'),
      itensAngiografia: itensAgrupados(6, 'Paciente Angio'),
      guiasCartaRede: 0, // informado explicitamente como zero — não gera alerta
    });
    expect(r.guias).toBe(9);
    // até 30 guias, credenciado = R$263,59 (TABELA_PRECO_PADRAO.HAPVIDA_CRED)
    expect(r.totalValor).toBeCloseTo(263.59, 2);
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_CRED', guias: 9, valor: 263.59 }),
    ]);
    expect(r.status).toBe('ok');
  });

  it('não credenciado usa a tabela HAPVIDA_NAO_CRED (mesma soma, faixa diferente)', () => {
    const r = processarMedico({
      medico: angiologista({ statusHapvida: 'nao_credenciado' }),
      itens: [],
      itensCateter: itensAvulsos(9, 'Cateter'),
    });
    expect(r.guias).toBe(9);
    // até 30 guias, não credenciado = R$310,06
    expect(r.totalValor).toBeCloseTo(310.06, 2);
    expect(r.subtotais[0]?.classe).toBe('HAPVIDA_NAO_CRED');
  });

  it('lote de Cateter não selecionado (undefined) → alerta explícito, 0 guias daquele lote, NUNCA chuta', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensFistula: itensAvulsos(5, 'Fistula'),
      // itensCateter ausente de propósito
    });
    expect(r.guias).toBe(5); // só a fístula
    expect(r.alertas.some((a) => a.includes('Cateter') && a.includes('não foi selecionado'))).toBe(true);
    expect(r.status).toBe('alerta');
  });

  it('lote de Cateter SELECIONADO mas vazio ([]) → 0 guias daquele lote, SEM alerta (foi selecionado, só não tinha produção no mês)', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensCateter: [],
      itensFistula: itensAvulsos(5, 'Fistula'),
    });
    expect(r.guias).toBe(5);
    expect(r.alertas.some((a) => a.includes('Cateter'))).toBe(false);
  });

  it('nenhum dos 4 lotes selecionado/informado → alerta (1 por lote), nunca chuta valor', () => {
    const r = processarMedico({ medico: angiologista(), itens: [] });
    expect(r.status).toBe('alerta');
    expect(r.guias).toBe(0);
    expect(r.totalValor).toBe(0);
    expect(r.subtotais).toEqual([]);
    expect(r.alertas).toHaveLength(4); // Cateter, Fístula, Angiografia e Carta de Rede, cada um seu alerta
  });

  it('os 4 lotes selecionados/informados mas todos vazios/zero → sem_dados (selecionado sem produção não é erro)', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensCateter: [],
      itensFistula: [],
      itensAngiografia: [],
      guiasCartaRede: 0,
    });
    expect(r.status).toBe('sem_dados');
    expect(r.guias).toBe(0);
  });

  it('Carta de Rede informada manualmente (5) soma com os outros 3 lotes na mesma faixa HAPVIDA', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensCateter: itensAvulsos(4, 'Cateter'),
      itensFistula: itensAvulsos(3, 'Fistula'),
      itensAngiografia: itensAgrupados(6, 'Paciente Angio'),
      guiasCartaRede: 5,
    });
    expect(r.guias).toBe(14); // 4 + 3 + 2 (teto(6/3)) + 5
    expect(r.status).toBe('ok');
    expect(r.subtotais[0]?.faixa).toContain('5 guia(s) de Carta de Rede informada(s) manualmente');
  });

  it('Carta de Rede não informada (undefined) → alerta explícito, 0 guias daquele lote, NUNCA chuta', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: [],
      itensCateter: itensAvulsos(5, 'Cateter'),
      // guiasCartaRede ausente de propósito
    });
    expect(r.guias).toBe(5); // só o cateter
    expect(r.alertas.some((a) => a.includes('Carta de Rede') && a.includes('não foi informada'))).toBe(true);
    expect(r.status).toBe('alerta');
  });

  it('itens do lote principal (main "itens") são ignorados pro Angiologista — não existe pra essa especialidade', () => {
    const r = processarMedico({
      medico: angiologista(),
      itens: itensAvulsos(50, 'Ignorado'), // não deveria contar
      itensCateter: itensAvulsos(3, 'Cateter'),
    });
    expect(r.guias).toBe(3); // só o cateter, os 50 itens de `itens` foram ignorados
  });

  it('semExcedentePorGuia (Story 10.7) se aplica normalmente à faixa combinada', () => {
    // 181 guias de cateter — acima do teto de 180 (última faixa) da tabela padrão.
    const comExcedente = processarMedico({
      medico: angiologista(),
      itens: [],
      itensCateter: itensAvulsos(181, 'Cateter'),
    });
    const semExcedente = processarMedico({
      medico: angiologista({ semExcedentePorGuia: true }),
      itens: [],
      itensCateter: itensAvulsos(181, 'Cateter'),
    });
    // Com excedente por guia: 950.89 (teto 180, credenciado) + 1×6.00 = 956.89
    expect(comExcedente.totalValor).toBeCloseTo(956.89, 2);
    // Sem excedente por guia: capa no teto da última faixa, sem somar por guia.
    expect(semExcedente.totalValor).toBeCloseTo(950.89, 2);
  });
});
