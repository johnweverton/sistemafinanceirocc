// Testes da tabela de preço (PRD §5.1) — faixas, excedente e o caso FORA DA TABELA (§11).
import { describe, it, expect } from 'vitest';
import type { ItemProducao } from '@cobranca/shared';
import { valorDaFaixa, classesDoMedico, TABELA_PRECO_PADRAO } from '../../../src/server/engine';
import { processarMedico } from '../../../src/server/engine/processar-medico';

describe('valorDaFaixa — HAPVIDA_CRED', () => {
  const t = TABELA_PRECO_PADRAO.HAPVIDA_CRED;
  it('30 guias → R$263,59 (primeira faixa)', () => {
    expect(valorDaFaixa(t, 30).valor).toBe(263.59);
  });
  it('17 guias → cai na faixa até 30', () => {
    const r = valorDaFaixa(t, 17);
    expect(r.valor).toBe(263.59);
    expect(r.faixa).toBe('até 30 guias');
  });
  it('180 guias → R$950,89 (última faixa)', () => {
    expect(valorDaFaixa(t, 180).valor).toBe(950.89);
  });
  it('200 guias → excedente por guia: 950,89 + 20×6 = 1070,89', () => {
    expect(valorDaFaixa(t, 200).valor).toBeCloseTo(950.89 + 20 * 6, 2);
  });
});

describe('valorDaFaixa — OUTROS_HOSPITAIS acima de 80 (PRD §11, revisado — Story 10.3)', () => {
  const t = TABELA_PRECO_PADRAO.OUTROS_HOSPITAIS;
  it('80 guias → R$367,36 (último teto definido)', () => {
    expect(valorDaFaixa(t, 80).valor).toBe(367.36);
  });
  // Story 10.3 (2026-07-20): decisão consciente do dono revisa o PRD §11 — antes o motor
  // devolvia "FORA DA TABELA" acima de 80; a planilha real sempre cobrou o teto fixo.
  // Caso de ouro: Dr. Anderson Ferreira (abr/2026) — 118 outros hospitais → R$367,36.
  it('81 guias → cobra o teto fixo R$367,36 (não extrapola por guia)', () => {
    const r = valorDaFaixa(t, 81);
    expect(r.valor).toBe(367.36);
    expect(r.faixa).toContain('acima de 80');
  });
  it('118 guias (Anderson Ferreira, abr/2026) → R$367,36, igual a 81', () => {
    expect(valorDaFaixa(t, 118).valor).toBe(367.36);
  });
});

describe('valorDaFaixa — IMOBILIZACOES (excedente fixo)', () => {
  const t = TABELA_PRECO_PADRAO.IMOBILIZACOES;
  it('150 guias → R$186,10', () => {
    expect(valorDaFaixa(t, 150).valor).toBe(186.1);
  });
  it('151 guias → valor fixo R$387,78', () => {
    expect(valorDaFaixa(t, 151).valor).toBe(387.78);
  });
});

describe('processarMedico — OUTROS_HOSPITAIS acima de 80, somado a Hapvida (Story 10.3)', () => {
  function item(id: number): ItemProducao {
    return {
      data: '2026-04-01',
      pacienteNome: `Paciente ${id}`,
      atendimentoExternoId: null,
      codigoProcedimento: '31309054',
      descricaoProcedimento: 'Procedimento teste',
      statusOrigem: 'Devidamente Pago',
      viaAcesso: false,
      tipoAto: 'Eletivo',
      valorCobradoOrigem: 100,
      valorPagoOrigem: 100,
    };
  }

  it('médico não-credenciado + outros hospitais, 90 guias → HAPVIDA_NAO_CRED + OUTROS_HOSPITAIS somados, sem alerta de FORA DA TABELA', () => {
    const itens = Array.from({ length: 90 }, (_, i) => item(i));
    const r = processarMedico({
      medico: {
        id: 'anderson', cpf: '00000000004', nome: 'Dr. Anderson Ferreira',
        statusHapvida: 'nao_credenciado', fazOutrosHospitais: true,
        fazImobilizacoes: false, modoMudancaData: 'nao', especialidade: 'Cardiologia',
      } as any,
      itens,
    });

    // 90 guias: HAPVIDA_NAO_CRED cai na faixa até 150 (852,84) + OUTROS_HOSPITAIS acima de 80
    // agora cobra o teto fixo (367,36) em vez de FORA DA TABELA.
    expect(r.subtotais).toEqual([
      expect.objectContaining({ classe: 'HAPVIDA_NAO_CRED', valor: 852.84 }),
      expect.objectContaining({ classe: 'OUTROS_HOSPITAIS', valor: 367.36 }),
    ]);
    expect(r.totalValor).toBeCloseTo(852.84 + 367.36, 2);
    expect(r.status).toBe('ok');
    expect(r.alertas.some((a) => a.includes('FORA DA TABELA'))).toBe(false);
  });
});

describe('classesDoMedico (porte 1:1 do Python — ver TODO §11)', () => {
  it('credenciado sem outros → [HAPVIDA_CRED]', () => {
    expect(classesDoMedico({ statusHapvida: 'credenciado', fazOutrosHospitais: false, fazImobilizacoes: false })).toEqual([
      'HAPVIDA_CRED',
    ]);
  });
  it('não credenciado sem outros → [HAPVIDA_NAO_CRED]', () => {
    expect(classesDoMedico({ statusHapvida: 'nao_credenciado', fazOutrosHospitais: false, fazImobilizacoes: false })).toEqual([
      'HAPVIDA_NAO_CRED',
    ]);
  });
  it('credenciado + outros + imobilizações → 3 classes', () => {
    expect(
      classesDoMedico({ statusHapvida: 'credenciado', fazOutrosHospitais: true, fazImobilizacoes: true }),
    ).toEqual(['HAPVIDA_CRED', 'OUTROS_HOSPITAIS', 'IMOBILIZACOES']);
  });
});
